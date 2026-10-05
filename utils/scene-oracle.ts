import type { SceneTextResponse } from '~/types/scene'
import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { hasWord, isDense, normalize, significant } from '~/utils/text-match'
import { pack, translate } from '~/utils/languages'
import { isTakeable, visible } from '~/utils/interactables'
import { answerClue } from '~/utils/puzzles'
import { isSecondLook } from '~/utils/puzzle-look'

/**
 * Répond localement, sans appeler le modèle.
 *
 * La génération de scène a déjà produit — et déjà facturé — la description de
 * chaque élément de décor, ce que sait chaque personnage, la quête et l'objet.
 * Rappeler gpt-4o pour ressortir ces informations revient à payer deux fois.
 *
 * Cet oracle sert donc tout ce qui est déjà connu, et ne laisse au modèle que
 * ce qu'il est seul à savoir faire : une réplique neuve, une réaction inédite.
 */

export type LocalAnswerKind = 'decor' | 'npc_known' | 'guidance' | 'budget_exhausted'

/** Ce que l'oracle a besoin de savoir du joueur pour répondre sans le modèle. */
export interface OracleState {
  hasKeyItem: boolean
  talkedToNpcIds: string[]
  /** Les ids de ce qu'il porte déjà : ce qui est ramassé n'est plus à trouver. */
  carriedIds: string[]
  /** Ce qu'un échange a fait apparaître : avant ça, l'élément n'existe pas. */
  revealedIds: string[]
  /** Les choses déjà regardées dans ce lieu, par leur nom. */
  lookedLabels?: string[]
}

export interface LocalAnswer {
  text: string
  kind: LocalAnswerKind
  /** Rendu comme réplique de PNJ plutôt que comme narration. */
  npcName?: string
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(normalize(n)))
}

/**
 * Le nom d'un élément apparaît-il dans la commande ?
 *
 * Les mots vides viennent du pack : ils étaient français en dur, et « dans »
 * ou « avec » ne filtrent rien dans une phrase anglaise — c'est « with » et
 * « from » qu'il faut y écarter, sans quoi un nom composé les prendrait pour
 * des mots pleins et matcherait n'importe quelle commande qui les contient.
 */
function nameScore(input: string, name: string, lang: LangCode): number {
  const stopwords = pack(lang).input.stopwords.map(normalize)
  const clean = (value: string) => normalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  const normalizedName = clean(name)
  const words = normalizedName
    .split(' ')
    .filter(w => significant(w, 3) && !stopwords.includes(w))
  if (!words.length) return 0

  const haystack = ` ${clean(input)} `
  const exact = isDense(normalizedName)
    ? haystack.includes(normalizedName)
    : haystack.includes(` ${normalizedName} `)
  if (exact) return 10_000 + normalizedName.length

  const matches = words.filter(word => hasWord(haystack, word)).length
  // Le nombre de mots reconnus passe devant ; à égalité, le nom dont la
  // plus grande part a été tapée gagne. Ainsi « regarder le Verre Fendu »
  // ne retombe pas sur un « Éclat de Verre » déclaré avant lui.
  return matches ? matches * 100 - (words.length - matches) : 0
}

function namedIn(input: string, name: string, lang: LangCode): boolean {
  return nameScore(input, name, lang) > 0
}

/** Le nom le mieux désigné par la commande, pas simplement le premier partageant un mot. */
function bestNamed(input: string, names: string[], lang: LangCode): string | null {
  let best: string | null = null
  let score = 0
  for (const name of names) {
    const candidate = nameScore(input, name, lang)
    if (candidate > score) {
      best = name
      score = candidate
    }
  }
  return best
}

/**
 * La chose que cette saisie regarde, s'il y en a une : un élément du décor ou
 * un objet que le récit nomme. Null sans verbe de regard.
 */
export function lookedThing(
  input: string,
  scene: SceneTextResponse,
  state: Pick<OracleState, 'revealedIds'>,
  lang: LangCode = DEFAULT_LANG,
): string | null {
  const text = normalize(input)
  if (!containsAny(text, pack(lang).input.look)) return null
  return bestNamed(text, [
    ...scene.decor.map(dec => dec.name),
    ...visible(scene.interactables, state.revealedIds).map(o => o.label),
  ].filter(Boolean), lang)
}

/**
 * Le récapitulatif de progression, assemblé depuis la scène déjà générée.
 * C'est la réponse à « je fais quoi ? », et elle ne coûte rien.
 */
export function buildGuidance(
  scene: SceneTextResponse,
  state: OracleState,
  lang: LangCode = DEFAULT_LANG,
): string {
  const t = (key: string, vars?: Record<string, string>) => translate(lang, key, vars)
  const lines: string[] = []
  lines.push(t('oracle.quest', { title: scene.quest.title, objective: scene.quest.objective }))

  const item = scene.key_item
  if (item && !state.hasKeyItem) {
    const holder = scene.npcs.find(n => n.id === item.npc_id)
    const others = scene.npcs.filter(n => !state.talkedToNpcIds.includes(n.id))
    lines.push(t('oracle.missing'))
    // Là où l'objet n'est sur personne, envoyer le joueur faire le tour des
    // habitants est un mensonge : il est inscrit dans le lieu, et c'est la
    // loupe qui l'ouvre.
    if (item.acquisition === 'found' && scene.puzzle) {
      // L'énigme dit sa nature, pas sa solution : où regarder, et ce que
      // coûte de s'en passer.
      lines.push(t(`oracle.puzzle_${scene.puzzle.kind}`))
    } else if (item.acquisition === 'found') {
      lines.push(t('oracle.found_item'))
    } else if (others.length) {
      lines.push(t('oracle.not_talked', { names: others.map(n => n.name).join(', ') }))
    } else if (holder) {
      lines.push(t('oracle.holder_knows', { name: holder.name }))
    }
  } else if (item && scene.required_item_id && !state.carriedIds.includes(scene.required_item_id)) {
    // L'objet en main ne suffit pas ici : la moitié de carte manque, et la
    // renvoyer vers la sortie le ferait buter sur une porte fermée.
    lines.push(t('oracle.holding', { item: item.name, why: item.why }))
    lines.push(t('oracle.missing_piece'))
  } else if (item && scene.opens_with_card) {
    // Un lecteur garde la sortie : la franchir ne suffit pas, on s'en sert.
    lines.push(t('oracle.holding', { item: item.name, why: item.why }))
    lines.push(t('puzzle.use_card_prompt', { name: item.name }))
  } else if (item) {
    lines.push(t('oracle.holding', { item: item.name, why: item.why }))
    // Le tenir suffit : la porte ne réclame plus qu'on s'en soit servi.
    // Le libellé de la sortie plutôt que le premier mot-clé : depuis que les
    // mots-clés viennent du pack, le premier est un verbe générique
    // (« sortir », « exit ») et non le nom de la porte de CETTE scène.
    lines.push(t('oracle.just_exit', {
      exit: scene.exit_label || scene.paywall.exit_keywords[0] || '',
    }))
  }

  // Les gens ne donnent pas tout. Sans cette ligne, le récapitulatif n'envoie
  // le joueur que vers des personnages, et il traverse la salle sans voir que
  // le récit y a posé quelque chose — la Majuscule est le seul signal, et rien
  // d'autre ne le lui apprend.
  const loose = visible(scene.interactables, state.revealedIds).filter(
    obj => obj.label && isTakeable(obj, lang) && !state.carriedIds.includes(obj.id))
  if (loose.length) lines.push(t('oracle.takeable'))

  if (scene.npcs.length) {
    lines.push(t('oracle.present', {
      npcs: scene.npcs.map(n => `${n.name} (${n.archetype})`).join(' · '),
    }))
  }
  return lines.join('\n')
}

/**
 * Tente de répondre sans le modèle.
 *
 * Renvoie null quand seule une génération peut faire l'affaire — c'est alors,
 * et seulement alors, qu'on paie un tour.
 */
export function resolveLocally(
  input: string,
  scene: SceneTextResponse,
  state: OracleState,
  lang: LangCode = DEFAULT_LANG,
): LocalAnswer | null {
  const text = normalize(input)
  // Les formulations viennent du pack : « what do I do » ne ressemble en rien
  // à « je fais quoi », et une liste française n'aurait rien reconnu ailleurs —
  // chaque « aide ? » serait alors reparti en génération, donc facturé.
  const { guidance, look } = pack(lang).input

  // « Je fais quoi ? » — la réponse est entièrement dans la scène déjà générée.
  if (containsAny(text, guidance)) {
    return { text: buildGuidance(scene, state, lang), kind: 'guidance' }
  }

  // Observation d'un élément de décor : sa description est déjà écrite.
  if (containsAny(text, look)) {
    const thing = lookedThing(input, scene, state, lang)
    const element = scene.decor.find(dec => dec.name === thing)
    // L'INDICE DE L'ÉNIGME SE LIT AU DEUXIÈME OBJET REGARDÉ, quel qu'il soit.
    // Il n'est caché sur rien : le premier regard montre le lieu, le second
    // donne la réponse, et les suivants la redonnent. On ne doit ni tourner en
    // rond ni rester bloqué — demandé ainsi par le user.
    // Toutes les énigmes, fréquence comprise, suivent la même règle : le
    // premier objet regardé pose le lieu, le second donne la réponse en clair.
    const second = Boolean(scene.puzzle) && isSecondLook(thing, state.lookedLabels ?? [], state.hasKeyItem)
    // Refait depuis la solution, jamais relu dans `clues` : voir `answerClue`.
    const here = second ? [answerClue(scene.puzzle!, lang)] : []
    if (element?.description || here.length) {
      return { text: [element?.description, ...here].filter(Boolean).join('\n\n'), kind: 'decor' }
    }
  }

  // Un personnage déjà interrogé qui redit ce qu'il sait : aucune nouveauté à
  // générer. Le premier échange, lui, passe par le modèle.
  const npc = scene.npcs.find(n => namedIn(text, n.name, lang))
  if (npc && state.talkedToNpcIds.includes(npc.id) && containsAny(text, guidance)) {
    return { text: npc.knows, kind: 'npc_known', npcName: npc.name }
  }

  return null
}
