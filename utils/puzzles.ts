import type { DecorElement, Interactable, ScenePuzzle, PuzzleKind, PuzzleClue } from '~/types/scene'
import type { CarriedItem, JournalEntry } from '~/utils/journal'
import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { pack, translate } from '~/utils/languages'
import { normalize, matchesKeyword, hasWord, significant } from '~/utils/text-match'
import { fold } from '~/utils/naming'
import { isTakeable } from '~/utils/interactables'

/**
 * Une énigme par mécanique.
 *
 * Toutes les scènes où l'objet-clé « se trouve » se jouaient pareil : lire son
 * nom à la loupe, et c'était fini. La fréquence, le code, la séquence, la carte
 * cachée ou délivrée ne différaient que par le mot. Chacune a désormais sa
 * propre épreuve, et elle se résout SUR L'APPAREIL :
 *
 * - `frequency` : un cadran à régler, la valeur est écrite dans le lieu ;
 * - `code` : quatre chiffres, écrits dans le lieu ;
 * - `sequence` : les gestes du dénouement, leur ordre écrit dans le lieu ;
 * - `lock` : le lecteur ne prend que la carte du lieu que l'indice nomme ;
 * - `search` : la carte est cachée, et l'indice dit où.
 *
 * Chaque énigme n'a qu'UN indice, qui donne la réponse entière, et il se lit
 * au DEUXIÈME objet regardé, quel qu'il soit (`utils/scene-oracle.ts`) : on
 * ne doit ni tourner en rond, ni rester bloqué longtemps.
 *
 * LE MODÈLE N'Y EST POUR RIEN, sauf les libellés de la séquence. La solution et
 * ses indices sont tirés ICI, à l'assemblage, d'une graine propre à la scène :
 * un modèle qui écrit lui-même un code et ses fragments se contredit une fois
 * sur trois, et chaque contradiction serait une scène insoluble. Les indices
 * sont des phrases du pack de langue, posées sur les choses que le récit nomme
 * en Majuscule — le joueur les lit en REGARDANT, ce qui ne coûte aucun tour.
 *
 * Zéro requête : la vérification d'une réponse est une comparaison locale.
 */

/** Graine → générateur. mulberry32 : court, stable d'un moteur JS à l'autre. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Une chose que le récit nomme et qu'on peut regarder. */
interface Surface {
  id: string
  label: string
  /** L'élément du décor lointain : on le regarde, on ne le fouille pas. */
  far: boolean
}

/**
 * Ce qui peut porter un indice : le décor et les choses qu'on examine sans
 * les prendre, pourvu que le récit les nomme.
 *
 * Un indice posé sur une chose absente du texte serait introuvable : le joueur
 * ne sait regarder que ce qu'il a lu. Les objets qu'on ramasse sont exclus —
 * ils quittent la scène avec lui, et leur analyse a déjà son texte.
 */
export function surfacesOf(
  scene: { scene_text: string; decor?: DecorElement[]; interactables?: Interactable[] },
  lang: LangCode,
): Surface[] {
  const written = fold(scene.scene_text)
  const named = (label: string) => significant(label, 2) && written.includes(fold(label))
  const decor = (scene.decor ?? [])
    .filter(d => d.name && named(d.name))
    .map(d => ({ id: `decor:${d.slot_id}`, label: d.name, far: d.slot_id === 'lointain' }))
  const objects = (scene.interactables ?? [])
    .filter(o => o.label && !o.hidden && !o.triggers_paywall && !isTakeable(o, lang) && named(o.label))
    .map(o => ({ id: o.id, label: o.label, far: false }))
  // Un même nom déclaré deux fois ne fait qu'une surface.
  const seen = new Set<string>()
  return [...decor, ...objects].filter(s => {
    const key = fold(s.label)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Répartit les indices sur les surfaces, une par indice tant qu'il y en a. */
function spread(texts: string[], surfaces: Surface[], rand: () => number): PuzzleClue[] {
  const order = shuffle(surfaces, rand)
  // Sans surface, l'indice n'est sur rien : l'oracle le livre au deuxième
  // regard de toute façon (`answerClue`).
  return texts.map((text, i) => ({ on: order.length ? order[i % order.length]!.label : '', text }))
}

export interface PuzzleSource {
  scene_id: string
  scene_text: string
  decor?: DecorElement[]
  interactables?: Interactable[]
  key_item?: { name?: string; steps?: string[] } | null
}

/**
 * L'énigme d'une scène, tirée une fois pour toutes à l'assemblage.
 *
 * Null quand la scène n'a pas de quoi la porter — trop peu de choses nommées,
 * une séquence sans ses gestes, pas assez de cartes en poche. Le jeu retombe
 * alors sur la lecture à la loupe, qui a toujours marché : une énigme
 * impossible coûterait bien plus cher qu'une énigme absente.
 */
export function drawPuzzle(
  kind: PuzzleKind | undefined,
  scene: PuzzleSource,
  opts: { lang?: LangCode; carried?: CarriedItem[]; journal?: JournalEntry[] } = {},
): ScenePuzzle | null {
  if (!kind) return null
  const lang = opts.lang ?? DEFAULT_LANG
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, `puzzle.${key}`, vars)
  const rand = rng(`${scene.scene_id}|${scene.scene_text}`)
  // PAS DE SURFACE NE FAIT PLUS TOMBER L'ÉNIGME. L'indice se livre au deuxième
  // regard, quel qu'il soit : un récit qui ne nomme qu'un objet faisait
  // disparaître le panneau, et la loupe rendait l'objet sans épreuve. Seule la
  // fouille a besoin d'endroits où plonger la main.
  const surfaces = surfacesOf(scene, lang)

  if (kind === 'frequency') {
    // La fréquence suit la même règle de lecture que les autres énigmes : le
    // premier objet regardé pose le lieu, le second livre la valeur entière.
    // Le cadran reste verrouillé derrière la lecture à la loupe de l'objet-clé.
    if (!surfaces.length) return null
    const solution = 20 + Math.floor(rand() * 80)
    return {
      kind,
      solution,
      min: 10,
      max: 99,
      clues: spread([t('freq_value', { value: solution })], surfaces, rand),
    }
  }

  // LES AUTRES (hors fréquence) SUIVENT LA RÈGLE (demandée par le user : on ne doit ni
  // tourner en rond, ni rester bloqué longtemps). Un SEUL indice, qui donne la
  // réponse entière, et que l'oracle livre au deuxième objet regardé, quel
  // qu'il soit. Plus de morceaux à recoller, plus d'indice dans la poche.

  if (kind === 'code') {
    const code = String(Math.floor(rand() * 10000)).padStart(4, '0')
    return { kind, solution: code, clues: spread([t('code_value', { code })], surfaces, rand) }
  }

  if (kind === 'sequence') {
    // Les gestes viennent du modèle — ce sont ceux du dénouement de CE joueur.
    // L'indice les recopie dans l'ordre, d'un bout à l'autre.
    const steps = (scene.key_item?.steps ?? []).map(s => s?.trim()).filter((s): s is string => Boolean(s))
    if (steps.length < 3 || steps.length > 5 || new Set(steps.map(fold)).size !== steps.length) return null
    let display = shuffle(steps.map((_, i) => i), rand)
    // Présentée déjà dans l'ordre, elle serait résolue avant d'être lue.
    if (display.every((v, i) => v === i)) display = [...display.slice(1), display[0]!]
    return {
      kind,
      steps: display.map(i => steps[i]!),
      solution: steps.map((_, i) => display.indexOf(i)),
      clues: spread([t('seq_order', { steps: steps.join(' → ') })], surfaces, rand),
    }
  }

  if (kind === 'lock') {
    // LA CARTE D'UN LIEU DÉJÀ TRAVERSÉ. C'est tout le sens d'un inventaire qui
    // voyage : la serrure d'ici répond à une carte prise plus tôt. Il en faut
    // au moins deux — avec une seule, il n'y a rien à choisir.
    // Une fréquence ou un code sont aussi des objets qui ouvrent, mais ils
    // n'ont pas de couleur : seules les cartes entrent dans un lecteur.
    const cards = (opts.carried ?? [])
      .filter(c => c.kind === 'key' && c.id !== 'cle_auberge' && c.from && c.color)
    if (cards.length < 2) return null
    // LA RÉPONSE EST UNE CARTE QU'UN LIEU A DÉLIVRÉE. Une couleur portée deux
    // fois ne peut pas être la réponse : l'indice ne saurait laquelle désigner.
    const twice = (c: CarriedItem) => cards.filter(o => fold(o.color!) === fold(c.color!)).length > 1
    const answers = cards.filter(c => c.id.startsWith('cle_') && !twice(c))
    if (!answers.length) return null
    const card = answers[Math.floor(rand() * answers.length)]!
    // L'indice NOMME le lieu où la carte a été prise : le lecteur affiche ce
    // lieu à côté de chaque carte, il n'y a plus qu'à les rapprocher.
    return {
      kind,
      card_id: card.id,
      place: card.from!,
      clues: spread([t('lock_clue', { place: card.from! })], surfaces, rand),
    }
  }

  if (kind === 'search') {
    // L'indice dit où elle est. Fouiller ailleurs coûte toujours la nuit,
    // mais il suffit d'avoir regardé deux choses pour savoir où plonger la main.
    // Le lointain se regarde mais ne se fouille pas.
    const spots = shuffle(surfaces.filter(s => !s.far), rand).slice(0, 4)
    if (spots.length < 3) return null
    const solution = spots[Math.floor(rand() * spots.length)]!
    return {
      kind,
      spots: spots.map(s => ({ id: s.id, label: s.label })),
      solution: solution.id,
      clues: spread([t('search_here', { spot: solution.label })], surfaces, rand),
    }
  }

  return null
}

/**
 * L'indice qui donne la réponse entière, refait depuis la solution.
 *
 * Jamais relu dans `clues` : une scène gardée par le navigateur depuis avant la
 * règle du deuxième regard y porte encore les anciens morceaux (fourchette,
 * parité, somme), et le joueur ne recevait jamais la valeur elle-même.
 */
export function answerClue(puzzle: ScenePuzzle, lang: LangCode = DEFAULT_LANG): string {
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, `puzzle.${key}`, vars)
  switch (puzzle.kind) {
    case 'frequency': return t('freq_value', { value: puzzle.solution })
    case 'code': return t('code_value', { code: puzzle.solution })
    case 'sequence': return t('seq_order', { steps: puzzle.solution.map(i => puzzle.steps[i]).join(' → ') })
    case 'lock': return t('lock_clue', { place: puzzle.place })
    case 'search': {
      const spot = puzzle.spots.find(s => s.id === puzzle.solution)?.label ?? ''
      return t('search_here', { spot })
    }
  }
}

/** La réponse est-elle la bonne ? La forme dépend de l'énigme. */
export function isSolved(puzzle: ScenePuzzle, answer: string | number | number[]): boolean {
  switch (puzzle.kind) {
    case 'frequency': return Number(answer) === puzzle.solution
    case 'code': return String(answer) === puzzle.solution
    case 'sequence':
      return Array.isArray(answer)
        && answer.length === puzzle.solution.length
        && answer.every((v, i) => v === puzzle.solution[i])
    case 'lock': return String(answer) === puzzle.card_id
    case 'search': return String(answer) === puzzle.solution
  }
}

/**
 * L'endroit que cette saisie fouille, s'il en fouille un.
 *
 * Le verbe doit y être — « regarder le Comptoir » lit l'indice, « fouiller le
 * Comptoir » y plonge la main, et seul le second coûte la nuit. Le nom le plus
 * long d'abord, pour que « la Trappe Grise » ne se fasse pas coiffer par « la
 * Trappe ».
 */
export function searchedSpot(
  input: string,
  puzzle: ScenePuzzle | null | undefined,
  lang: LangCode = DEFAULT_LANG,
): { id: string; label: string } | null {
  if (puzzle?.kind !== 'search') return null
  const p = pack(lang)
  if (!matchesKeyword(input, p.input.search)) return null
  const text = ` ${normalize(input).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const stop = p.input.stopwords.map(normalize)
  const score = (label: string) => normalize(label)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => significant(w, 3) && !stop.includes(w))
    .filter(w => hasWord(text, w)).length
  const ranked = puzzle.spots
    .map(s => ({ s, n: score(s.label) }))
    .filter(x => x.n > 0)
    .sort((x, y) => y.n - x.n || y.s.label.length - x.s.label.length)
  return ranked[0]?.s ?? null
}
