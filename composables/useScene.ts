import type { SceneTextResponse } from '~/types/scene'
import type { LangCode } from '~/types/i18n'
import type { UserProfile } from '~/types/user'
import type { JournalEntry, CarriedItem } from '~/utils/journal'
import type { AdmissionForm } from '~/utils/admission'
import { profileFromAdmission } from '~/utils/admission'
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useImageGen } from '~/composables/useImageGen'
import { readSceneImage, storeSceneImage, forgetSceneImage } from '~/utils/scene-image-memory'

/**
 * Une scène de l'auberge prend 50 à 80 s : environ 18 000 jetons de prompt, et
 * un JSON de 4 000 à 6 000 jetons avec le plan de la nuit. Une scène refusée
 * par la validation vaut une reprise qui le réécrit en entier — le double. À
 * 90 s, le navigateur abandonnait une scène que le serveur allait livrer, et
 * qu'il avait déjà payée.
 */
const SCENE_TEXT_TIMEOUT_MS = 240_000

/**
 * Orchestre le pipeline découplé.
 *
 * Le texte arrive en ~20 s et la scène est jouable immédiatement ; l'image
 * arrive ~25 s plus tard et se glisse au-dessus du texte sans bloquer. Les
 * deux appels ne doivent jamais être fusionnés : ensemble ils dépassent
 * n'importe quel timeout serverless.
 */
/**
 * La scène en cours, gardée par le navigateur.
 *
 * Recharger la page relançait une génération — texte et image, le poste de
 * dépense le plus cher du jeu. Or son monde existe déjà : on le remet en place
 * au lieu de le repayer.
 */
const SCENE_KEY = 'tg_scene'

/**
 * La mémoire du navigateur.
 *
 * `localStorage` et non `sessionStorage` : la partie ne dure pas une visite.
 * Le droit d'accès ouvert par le paiement court sur huit jours et la position
 * voyage dans un cookie de même durée.
 *
 * Elle ne quitte JAMAIS la machine du joueur : rien n'est enregistré côté
 * serveur, qui ne tient aucune base. Elle s'efface avec les données du site, en
 * repartant de zéro depuis l'accueil, ou d'elle-même passé la fenêtre.
 *
 * L'accès peut lever : navigation privée, cookies refusés. On régénérera.
 */
function memory(): Storage | null {
  if (!import.meta.client) return null
  try { return window.localStorage } catch { return null }
}

/**
 * Combien de temps le navigateur retient une partie.
 *
 * Alignée sur la fenêtre payante, comme le cookie de position : la mémoire ne
 * doit pas survivre au droit qui permet de s'en servir.
 */
function memoryDays(): number {
  return (useRuntimeConfig().public.memoryDays as number) || 8
}

/**
 * Format de ce que le navigateur garde : la scène, sa progression.
 *
 * À incrémenter à la main quand `SceneTextResponse` ou `SceneProgress` change de
 * forme au point qu'une copie ancienne casserait l'écran.
 */
const MEMORY_FORMAT = 1

/** Empreinte du script servi, calculée dans `nuxt.config.ts`. */
function currentFingerprint(): string {
  return useRuntimeConfig().public.scriptFingerprint as string
}

/**
 * @param expectedId la scène attendue, quand on en vise une précise.
 *
 * Une scène gardée n'est reprise que si c'est la même scène, le même script et
 * la même langue : sinon elle parlerait d'un autre lieu, suivrait d'anciennes
 * consignes, ou resterait dans l'ancienne langue.
 */
function readStoredScene(expectedId?: string, lang?: LangCode): SceneTextResponse | null {
  try {
    const raw = memory()?.getItem(SCENE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as SceneTextResponse
    if ((expectedId && stored.scene_id !== expectedId)
      || stored.memory_format !== MEMORY_FORMAT
      || stored.script_fingerprint !== currentFingerprint()
      || (lang && stored.lang && stored.lang !== lang)) {
      forgetStoredScene()
      return null
    }
    return stored
  } catch {
    return null
  }
}

function storeScene(scene: SceneTextResponse, lang: LangCode): void {
  try {
    memory()?.setItem(SCENE_KEY, JSON.stringify({ ...scene, memory_format: MEMORY_FORMAT, lang }))
  } catch {
    // Stockage plein ou refusé : on régénérera, c'est tout.
  }
}

/**
 * Ce que le joueur emporte, et qui doit survivre à la fermeture du navigateur.
 *
 * Sans ça, revenir en pleine partie ramenait la scène en cours mais effaçait
 * tout ce qui l'avait précédée : la scène suivante serait alors née comme si le
 * joueur venait de nulle part.
 */
const CARRY_KEY = 'tg_carry'

interface Carry {
  journal: JournalEntry[]
  inventory: Array<{
    id: string; label: string; from?: string
    kind: 'key' | 'lore' | 'trade'; color?: string
    /** La couleur de la carte, figée au ramassage : la pastille en dépend. */
    hex?: string
    /** Ce que l'analyse en dira. Recopié de la scène au ramassage. */
    observation?: string
  }>
  decrypted: string[]
  augmentation: boolean
  /** Son nom et ce qu'on en voit : elle n'est pas dans l'inventaire. */
  augmentationItem?: GameStore['augmentation']
  primerSeen: boolean
  /** La fenêtre de l'oeil a été lue : le bouton l'ouvre sans elle. */
  eyePrimerSeen?: boolean
  /** La fenêtre « comment jouer » de l'auberge a été lue. */
  howtoSeen?: boolean
  /**
   * Le profil du joueur, tel que Meta l'a donné et que le classifieur l'a rangé.
   *
   * Il n'y était pas, et un rechargement le perdait : la scène suivante
   * repartait alors du personnage de démonstration, dans un monde qui n'était
   * plus le sien. C'est la seule donnée personnelle de cette mémoire — elle
   * reste sur la machine du joueur, et disparaît avec le reste de la partie.
   */
  profile?: UserProfile | null
  /** Les objets cédés : un échange est définitif, un rechargement ne le défait pas. */
  given?: string[]
  /** Ce que la partie a coûté au modèle. Les plafonds de rythme s'y lisent. */
  spend?: { turns: number; usd: number }
  /** Date de la dernière écriture. Au-delà de la fenêtre, tout est oublié. */
  saved_at?: number
}

type GameStore = ReturnType<typeof useGameStore>
type PlayerStore = ReturnType<typeof usePlayerStore>

function carryOf(game: GameStore, player: PlayerStore): Carry {
  return {
    journal: player.journal,
    inventory: game.inventory,
    decrypted: game.decryptedObjectIds,
    augmentation: game.hasAugmentation,
    augmentationItem: game.augmentation,
    primerSeen: game.primerSeen,
    eyePrimerSeen: game.eyePrimerSeen,
    howtoSeen: game.howtoSeen,
    profile: player.profile,
    given: game.givenItemIds,
    spend: { turns: game.modelTurnsUsed, usd: game.spentUsd },
  }
}

/**
 * Ce qui s'est joué DANS la scène en cours.
 *
 * Sans elle la scène revenait nue au rechargement — et surtout avec ses tours
 * remis à zéro : recharger aurait suffi à repousser la fermeture de la ville.
 */
const PROGRESS_KEY = 'tg_progress'

interface SceneProgress {
  /** L'empreinte de la scène jouée : une autre scène, même de même id, ne la reprend pas. */
  stamp: string
  narrative: GameStore['narrativeHistory']
  turnCount: number
  activeNpcId: string | null
  hasKeyItem: boolean
  keyItemExchanges: number
  informedAboutItem: boolean
  pendingKeyItem: boolean
  talkedToNpcIds: string[]
  revealedInteractableIds: string[]
  npcExchanges: Record<string, number>
  resolved: boolean
  conversationHistory: GameStore['conversationHistory']
  npcThreads: GameStore['npcThreads']
  puzzleUnlocked: boolean
  searchedSpotIds: string[]
  lookedLabels: string[]
}

/**
 * L'empreinte d'une scène générée.
 *
 * L'id ne suffit pas : une scène régénérée garde son id et change tout le
 * reste. Une progression ou une image posée sur une autre version de la même
 * scène parlerait de personnages qui n'y sont plus.
 */
export function sceneStamp(scene: SceneTextResponse): string {
  const source = `${scene.scene_id}|${scene.script_fingerprint ?? ''}|${scene.scene_title}|${scene.scene_text}`
  let hash = 5381
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0
  return `${scene.scene_id}:${(hash >>> 0).toString(36)}`
}

function readProgress(stamp: string): SceneProgress | null {
  try {
    const raw = memory()?.getItem(PROGRESS_KEY)
    if (!raw) return null
    const progress = JSON.parse(raw) as SceneProgress
    return progress.stamp === stamp ? progress : null
  } catch {
    return null
  }
}

/**
 * Écrit la partie telle qu'elle est, pendant qu'on joue.
 *
 * Appelé par `plugins/run-memory.client.ts` à chaque changement du store. Rien
 * n'est écrit hors de l'écran de jeu, ni pendant qu'un tour s'écrit : l'entrée
 * serait à moitié remplie, et la sauvegarde d'avant vaut mieux.
 */
export function savePlaying(game: GameStore, player: PlayerStore): void {
  if (game.currentScreen !== 'playing' || game.playingSubState !== 'awaiting_input' || !player.scene) return
  storeCarry(carryOf(game, player))

  const progress: SceneProgress = {
    stamp: sceneStamp(player.scene),
    narrative: game.narrativeHistory,
    turnCount: game.turnCount,
    activeNpcId: game.activeNpcId,
    hasKeyItem: game.hasKeyItem,
    keyItemExchanges: game.keyItemExchanges,
    informedAboutItem: game.informedAboutItem,
    pendingKeyItem: game.pendingKeyItem,
    talkedToNpcIds: game.talkedToNpcIds,
    revealedInteractableIds: game.revealedInteractableIds,
    npcExchanges: game.npcExchanges,
    resolved: game.resolved,
    conversationHistory: game.conversationHistory,
    npcThreads: game.npcThreads,
    puzzleUnlocked: game.puzzleUnlocked,
    searchedSpotIds: game.searchedSpotIds,
    lookedLabels: game.lookedLabels,
  }
  try {
    memory()?.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // Stockage plein ou refusé : on reprendra au début de la scène.
  }
}

/**
 * Écrit la partie tout de suite, hors de l'écran de jeu.
 *
 * Le sommeil rembobine la nuit puis ferme la ville : `savePlaying` n'écrit que
 * sur l'écran `playing`, et le rechargement suivant aurait rendu la partie
 * d'avant le sommeil — l'horloge à l'aube, qui l'aurait rendormi aussitôt.
 */
export function saveRun(game: GameStore, player: PlayerStore): void {
  storeCarry(carryOf(game, player))
}

function storeCarry(carry: Carry): void {
  try {
    memory()?.setItem(CARRY_KEY, JSON.stringify({ ...carry, saved_at: Date.now() }))
  } catch {
    // Stockage plein ou refusé : on régénérera.
  }
}

function readStoredCarry(): Carry | null {
  try {
    const raw = memory()?.getItem(CARRY_KEY)
    if (!raw) return null
    const carry = JSON.parse(raw) as Carry

    // Passée la fenêtre, la partie et le profil s'effacent ensemble.
    if (carry.saved_at && Date.now() - carry.saved_at > memoryDays() * 86_400_000) {
      forgetRun()
      return null
    }
    return carry
  } catch {
    return null
  }
}

/**
 * Le dossier d'admission que ce navigateur a retenu, s'il y en a un.
 *
 * L'accueil s'en sert pour ne PAS refaire remplir le formulaire à quelqu'un
 * qui l'a déjà rempli : le bureau a ses données, il n'a plus qu'à sortir de
 * chez lui. Le profil est rendu tel quel — c'est celui qu'on remettra dans le
 * store si le joueur repart pour une nuit.
 */
export function rememberedProfile(): UserProfile | null {
  return readStoredCarry()?.profile ?? null
}

/**
 * Les réponses au formulaire d'admission, telles que le joueur les a tapées.
 *
 * Le profil ne suffit pas à les rendre : il est déjà converti, nettoyé,
 * complété de ce qu'on en déduit. Rouvrir le formulaire le rendait donc vide,
 * et corriger une ligne demandait de retaper les vingt autres.
 *
 * À PART de la partie : `forgetRun` passe à chaque entrée dans le formulaire,
 * à la démo et à chaque nouvelle nuit — c'est justement là qu'on a besoin de
 * retrouver ses réponses. Elles s'effacent par le bouton du formulaire, avec
 * les données du site, ou d'elles-mêmes passé la fenêtre.
 */
const ADMISSION_KEY = 'tg_admission'

export interface KeptAdmission {
  form: AdmissionForm
  /** L'étape où le joueur s'était arrêté. */
  step: number
  saved_at: number
}

export function rememberedAdmission(): KeptAdmission | null {
  try {
    const raw = memory()?.getItem(ADMISSION_KEY)
    if (!raw) return null
    const kept = JSON.parse(raw) as KeptAdmission
    if (!kept?.form || Date.now() - kept.saved_at > memoryDays() * 86_400_000) {
      forgetAdmission()
      return null
    }
    return kept
  } catch {
    return null
  }
}

export function storeAdmission(form: AdmissionForm, step: number): void {
  try {
    const kept: KeptAdmission = { form, step, saved_at: Date.now() }
    memory()?.setItem(ADMISSION_KEY, JSON.stringify(kept))
  } catch {
    // Stockage plein ou refusé : le joueur retapera, c'est tout.
  }
}

export function forgetAdmission(): void {
  try { memory()?.removeItem(ADMISSION_KEY) } catch { /* sans conséquence */ }
}

/** Oublie la scène en cours : son texte, ce qui s'y est joué, son image. */
export function forgetStoredScene(): void {
  try { memory()?.removeItem(SCENE_KEY) } catch { /* sans conséquence */ }
  try { memory()?.removeItem(PROGRESS_KEY) } catch { /* sans conséquence */ }
  void forgetSceneImage()
}

/**
 * Oublie la partie entière : la scène ET ce qui la traversait.
 *
 * Pour le joueur qui repart de zéro depuis l'accueil, et pour lui seul.
 * `forgetStoredScene` ne suffit pas : sans ce coup de balai, on repartait à
 * l'auberge avec le journal, l'inventaire et l'augmentation de la partie
 * précédente — une première scène jouée par quelqu'un qui avait déjà tout.
 */
export function forgetRun(): void {
  forgetStoredScene()
  try { memory()?.removeItem(CARRY_KEY) } catch { /* sans conséquence */ }
}

/**
 * Oublie l'aventure, garde le dossier.
 *
 * Pour « vider la mémoire » : on rejoue la nuit sans retaper le formulaire. Le
 * profil vit dans la même entrée que la partie — on la vide, puis on y remet
 * le dossier seul, sans journal, inventaire ni augmentation.
 *
 * Le profil n'entre dans la partie qu'une fois la première scène jouable :
 * avant, seul le formulaire le porte. On le refait alors depuis ses réponses,
 * sinon le bouton effaçait un dossier qu'il promet de garder.
 */
export function forgetAdventure(): void {
  const kept = rememberedAdmission()?.form
  const profile = rememberedProfile()
    ?? (kept?.firstName.trim() && kept.birthday.length === 10 ? profileFromAdmission(kept) : null)
  forgetRun()
  if (!profile) return
  storeCarry({
    journal: [], inventory: [], decrypted: [],
    augmentation: false, primerSeen: false, profile,
  })
}

/**
 * `?fresh=1` dans l'URL : jette la scène gardée et en demande une neuve. Pour
 * tester un prompt sans vider la mémoire.
 */
function wantsFresh(): boolean {
  if (!import.meta.client) return false
  return Boolean(useRoute().query.fresh)
}

/** L'aplat rendu par le serveur quand les images sont coupées. */
function isPlaceholder(image: string): boolean {
  return image.startsWith('data:image/svg+xml')
}

export function useScene() {
  const { t } = useLang()
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const { generateSceneImage } = useImageGen()
  /** Lue ici, dans le contexte du composant : l'image la consulte après des `await`. */
  const memoryWindowMs = memoryDays() * 86_400_000

  const scene = ref<SceneTextResponse | null>(null)
  const isLoadingText = ref(false)
  const error = ref<string | null>(null)
  const interfacePalette = useInterfacePalette()
  /** Quota gratuit épuisé : ce n'est pas une panne, c'est une invitation à payer. */
  const quotaExhausted = ref(false)

  /**
   * Ce que le joueur emporte d'une scène à l'autre, tel qu'il part au serveur.
   *
   * Un objet dont l'épreuve n'a pas été passée reste anonyme : le joueur ne
   * connaît pas son nom, la scène ne doit donc pas le prononcer.
   */
  function carried(): CarriedItem[] {
    return gameStore.inventory.map(o => ({
      id: o.id,
      label: o.label,
      decrypted: gameStore.decryptedObjectIds.includes(o.id),
      from: o.from,
      kind: o.kind,
      color: o.color,
      hex: o.hex,
    }))
  }

  /**
   * Sauvegarde ce qui appartient à la PARTIE, pas à la scène.
   *
   * Sans ça, un rechargement de page ramenait la scène mais reprenait au
   * joueur son augmentation et tout ce qu'il portait.
   */
  function saveCarry() {
    storeCarry(carryOf(gameStore, playerStore))
  }

  function restoreCarry() {
    const carry = readStoredCarry()
    if (!carry) return
    if (!playerStore.journal.length) playerStore.journal = carry.journal ?? []
    if (!gameStore.inventory.length) gameStore.inventory = carry.inventory ?? []
    if (!gameStore.decryptedObjectIds.length) gameStore.decryptedObjectIds = carry.decrypted ?? []
    if (carry.augmentation) gameStore.hasAugmentation = true
    if (!gameStore.augmentation && carry.augmentationItem) gameStore.augmentation = carry.augmentationItem
    gameStore.liftLegacyAugmentation()
    if (carry.primerSeen) gameStore.primerSeen = true
    if (carry.eyePrimerSeen) gameStore.eyePrimerSeen = true
    if (carry.howtoSeen) gameStore.howtoSeen = true
    if (!playerStore.profile && carry.profile) playerStore.setProfile(carry.profile)
    if (!gameStore.givenItemIds.length) gameStore.givenItemIds = carry.given ?? []
    if (carry.spend && !gameStore.modelTurnsUsed) {
      gameStore.modelTurnsUsed = carry.spend.turns
      gameStore.spentUsd = carry.spend.usd
    }
  }

  /** Un nouveau tirage ne doit pas hériter du déchiffrement du précédent. */
  function resealGeneratedKeyItem(generated: SceneTextResponse) {
    if (generated.key_item?.acquisition !== 'found') return
    const id = `cle_${generated.scene_id}`
    if (gameStore.inventory.some(item => item.id === id)) return
    gameStore.decryptedObjectIds = gameStore.decryptedObjectIds.filter(decrypted => decrypted !== id)
  }

  /**
   * Remet la scène où le joueur l'avait laissée.
   *
   * Faux s'il n'y a rien pour CETTE scène : on repart alors de son ouverture.
   */
  function restoreProgress(stored: SceneTextResponse): boolean {
    const progress = readProgress(sceneStamp(stored))
    if (!progress?.narrative?.length) return false
    gameStore.narrativeHistory = progress.narrative
    gameStore.turnCount = progress.turnCount
    gameStore.activeNpcId = progress.activeNpcId
    gameStore.hasKeyItem = progress.hasKeyItem
    gameStore.keyItemExchanges = progress.keyItemExchanges
    gameStore.informedAboutItem = progress.informedAboutItem
    gameStore.pendingKeyItem = progress.pendingKeyItem
    gameStore.talkedToNpcIds = progress.talkedToNpcIds
    gameStore.revealedInteractableIds = progress.revealedInteractableIds
    gameStore.npcExchanges = progress.npcExchanges
    gameStore.resolved = progress.resolved
    gameStore.conversationHistory = progress.conversationHistory
    gameStore.npcThreads = progress.npcThreads
    gameStore.puzzleUnlocked = progress.puzzleUnlocked ?? false
    gameStore.searchedSpotIds = progress.searchedSpotIds ?? []
    gameStore.lookedLabels = progress.lookedLabels ?? []
    return true
  }

  /** Phase 1. Bloquant : sans texte, pas de scène. */
  async function loadSceneText(sceneId?: string, user?: UserProfile) {
    isLoadingText.value = true
    error.value = null
    quotaExhausted.value = false

    // Garder les acquis de la partie avant de demander un nouveau tirage.
    restoreCarry()

    // L'inventaire de test ne s'équipe plus tout seul en local : la mémoire
    // vidée, on repart les poches vides. La commande `equipe` le charge.

    // Rechargement de page : la scène est déjà là, on la repose telle quelle.
    const stored = wantsFresh() ? null : readStoredScene(sceneId, playerStore.language)
    if (stored) {
      scene.value = stored
      interfacePalette.applyScene(stored)
      gameStore.syncAugmentation(stored.scene_id, stored.grants_augmentation)
      playerStore.setScene(stored)
      // Le fil de la scène, tel que le joueur l'a laissé ; à défaut, son ouverture.
      if (!restoreProgress(stored)) gameStore.addNarrativeEntry('narration', stored.scene_text)
      gameStore.setPlayingSubState('awaiting_input')
      isLoadingText.value = false
      return stored
    }

    try {
      const res = await $fetch<SceneTextResponse>('/api/scene/text', {
        method: 'POST',
        // `user ?? profil restauré` : sur une reprise, l'appelant n'a encore
        // rien en main — c'est `restoreCarry` juste au-dessus qui vient de
        // remettre le profil en place.
        body: {
          sceneId,
          user: user ?? playerStore.profile ?? undefined,
          journal: playerStore.journal,
          carried: carried(),
        },
        signal: AbortSignal.timeout(SCENE_TEXT_TIMEOUT_MS),
      })
      resealGeneratedKeyItem(res)
      scene.value = res
      // L'habillage prend les couleurs de la scène, si elle le demande.
      interfacePalette.applyScene(res)
      // Une scène neuve : ce qui s'était joué et dessiné pour la précédente ne la concerne pas.
      forgetStoredScene()
      storeScene(res, playerStore.language)
      gameStore.syncAugmentation(res.scene_id, res.grants_augmentation)
      saveCarry()
      playerStore.setScene(res)
      gameStore.addNarrativeEntry('narration', res.scene_text)
      gameStore.setPlayingSubState('awaiting_input')
      return res
    } catch (err) {
      // 429 : le quota gratuit est atteint. On ne montre pas d'erreur, on
      // propose la suite.
      if ((err as { statusCode?: number })?.statusCode === 429) {
        quotaExhausted.value = true
        return null
      }

      // 423 : la ville est fermée. Rien à charger, et surtout pas d'écran
      // d'erreur — le joueur doit voir la fermeture, pas une panne.
      if ((err as { statusCode?: number })?.statusCode === 423) {
        const closed = (err as { data?: { data?: { lockedUntil?: number; text?: string } } })
          ?.data?.data
        gameStore.closeCity({
          until: closed?.lockedUntil ?? Date.now() + 24 * 3600_000,
          reason: 'stalled',
          text: closed?.text,
        })
        return null
      }

      // `$fetch` emballe l'abandon dans une FetchError : le DOMException est
      // dans `cause`. Et WebKit le nomme AbortError (« Fetch is aborted »)
      // même quand c'est le timeout qui a tranché.
      const cause = (err as { cause?: unknown })?.cause ?? err
      const aborted = cause instanceof DOMException
        && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
      // Sur un 502, `err.message` ne dit que « 502 Bad Gateway » : la raison
      // réelle — troncature, JSON invalide, scène refusée par la validation —
      // voyage dans `data.statusMessage`. Sans elle, une panne de génération
      // est indiscernable d'une autre.
      const reason = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      error.value = aborted
        ? t('errors.scene_timeout')
        : reason || (err instanceof Error ? err.message : t('errors.scene_load'))
      return null
    } finally {
      isLoadingText.value = false
    }
  }

  /**
   * Phase 2. Non bloquant : on joue déjà pendant que l'image se dessine.
   * Une scène à illustration figée saute l'étape — rien n'est généré, donc
   * rien n'est facturé, et l'image est là immédiatement.
   */
  async function loadSceneImage(res: SceneTextResponse): Promise<string | null> {
    if (res.static_image) {
      gameStore.setSceneImage(res.static_image)
      gameStore.finishSceneImage()
      return res.static_image
    }

    // Déjà obtenue pour cette scène : ne pas repayer un remontage ou un renvoi.
    if (gameStore.currentSceneImageUrl) return gameStore.currentSceneImageUrl

    // Rechargement de page : l'image de CETTE scène est déjà dans le navigateur.
    const stamp = sceneStamp(res)
    gameStore.startSceneImage()
    const kept = await readSceneImage(stamp, memoryWindowMs)
    // L'aplat des images coupées (SVG) ne se garde pas : rallumées, elles
    // doivent être demandées, pas masquées par l'aplat d'hier.
    if (kept && !isPlaceholder(kept)) {
      gameStore.setSceneImage(kept)
      gameStore.finishSceneImage()
      return kept
    }

    const image = await generateSceneImage({
      sceneId: res.scene_id,
      placeName: res.place.name,
      palette: res.palette,
      decor: res.decor,
      // Le lieu vient du plan de la nuit : c'est lui que l'image dessine.
      planned: res.planned,
    })
    if (image && !isPlaceholder(image)) void storeSceneImage(stamp, image)
    return image
  }

  /** Le flux complet : texte d'abord, image ensuite, sans attendre. */
  async function enterScene(sceneId?: string, user?: UserProfile) {
    const res = await loadSceneText(sceneId, user)
    if (res) void loadSceneImage(res)
    return res
  }

  /** La commande du joueur touche-t-elle la porte ? */
  function hitsPaywall(input: string): boolean {
    const s = scene.value
    if (!s) return false
    if (gameStore.turnCount < s.paywall.min_turns_before_trigger) return false
    const lower = input.toLowerCase()
    return s.paywall.exit_keywords.some(kw => lower.includes(kw))
  }

  return { scene, isLoadingText, error, quotaExhausted, loadSceneText, loadSceneImage, enterScene, hitsPaywall }
}
