import type { SceneTextResponse } from '~/types/scene'
import type { UserProfile } from '~/types/user'
import type { JournalEntry, CarriedItem } from '~/utils/journal'
import type { AdmissionForm } from '~/utils/admission'
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useImageGen } from '~/composables/useImageGen'
import { forgetSceneImage } from '~/utils/scene-image-memory'

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
/** Stockage du parcours, du profil et de l'inventaire, pas des scènes générées. */
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
    profile: player.profile,
    given: game.givenItemIds,
    spend: { turns: game.modelTurnsUsed, usd: game.spentUsd },
  }
}

/** Conserve le parcours et le profil, jamais la scène ni ses tours. */
export function savePlaying(game: GameStore, player: PlayerStore): void {
  if (game.currentScreen !== 'playing' || game.playingSubState !== 'awaiting_input' || !player.scene) return
  storeCarry(carryOf(game, player))
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
  try { memory()?.removeItem('tg_scene') } catch { /* sans conséquence */ }
  try { memory()?.removeItem('tg_progress') } catch { /* sans conséquence */ }
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
 */
export function forgetAdventure(): void {
  const profile = rememberedProfile()
  forgetRun()
  if (!profile) return
  storeCarry({
    journal: [], inventory: [], decrypted: [],
    augmentation: false, primerSeen: false, profile,
  })
}

export function useScene() {
  const { t } = useLang()
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const { generateSceneImage } = useImageGen()

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
    }))
  }

  /**
   * Sauvegarde ce qui appartient à la PARTIE, pas à la scène.
   *
   * Le texte se régénère, mais le profil, l'augmentation et l'inventaire suivent.
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

  /** Phase 1. Bloquant : sans texte, pas de scène. */
  async function loadSceneText(sceneId?: string, user?: UserProfile) {
    isLoadingText.value = true
    error.value = null
    quotaExhausted.value = false

    // Garder les acquis de la partie avant de demander un nouveau tirage.
    restoreCarry()

    // En développement, on dispose de tout ce que le jeu prévoit : sans ça,
    // tester une scène tardive demanderait de rejouer toutes les précédentes.
    // `devInventory` vaut null en production, la ligne y est donc inerte.
    //
    // SAUF SUR LA PREMIÈRE SCÈNE : y arriver avec l'augmentation supprime la
    // seule boucle de jeu de l'auberge — la trouver, en apprendre l'existence,
    // puis se la faire céder. On la testait donc en la sautant.
    if (import.meta.dev) {
      const first = (useRuntimeConfig().public.sceneIndex as Array<{ id: string }>)?.[0]?.id
      if (sceneId && sceneId !== first) {
        gameStore.equipFromScript(useRuntimeConfig().public.devInventory as never)
      }
    }

    // Un ancien texte ou une ancienne image ne doivent jamais être rejoués.
    forgetStoredScene()

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

    return generateSceneImage({
      sceneId: res.scene_id,
      placeName: res.place.name,
      palette: res.palette,
      decor: res.decor,
      // Le lieu vient du plan de la nuit : c'est lui que l'image dessine.
      planned: res.planned,
    })
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
