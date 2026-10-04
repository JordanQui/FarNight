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
 * - `code` : quatre chiffres en deux morceaux, et une consigne d'ordre ;
 * - `sequence` : les gestes du dénouement à remettre dans l'ordre ;
 * - `lock` : le lecteur ne prend que la carte d'un lieu déjà traversé ;
 * - `search` : la carte est cachée, et ce que montre chaque endroit innocente
 *   un autre — on déduit avant de fouiller, parce que fouiller coûte la nuit.
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
function surfacesOf(
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
  return texts.map((text, i) => ({ on: order[i % order.length]!.label, text }))
}

/**
 * Un morceau de l'énigme voyage dans la poche du joueur.
 *
 * Dans Zork, on ramassait tout parce que tout pouvait servir dix pièces plus
 * loin. Ici, un indice de CE lieu est posé sur un objet ramassé AVANT —
 * un objet qui éclaire, jamais une carte ni un objet d'échange : le premier
 * n'a rien à voir avec une inscription, le second peut quitter la poche au
 * premier troc, et l'énigme deviendrait insoluble.
 *
 * LE TIRAGE PART DE CE QU'IL PORTE VRAIMENT, et c'est ce qui évite l'impasse
 * des vieux jeux : on ne revient pas en arrière ici, alors l'énigme ne réclame
 * jamais un objet qu'il n'a pas ramassé. Sans objet qui éclaire, l'indice
 * reste dans le lieu, comme avant.
 *
 * Le plus récent est évité quand il y a le choix : c'est la distance qui fait
 * le plaisir du rapprochement.
 */
function carryOne(
  clues: PuzzleClue[],
  carried: CarriedItem[] | undefined,
  rand: () => number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): PuzzleClue[] {
  const lore = (carried ?? []).filter(c => c.kind === 'lore' && c.label)
  if (!lore.length || !clues.length) return clues
  const pool = lore.length > 1 ? lore.slice(0, -1) : lore
  const holder = pool[Math.floor(rand() * pool.length)]!
  const at = Math.floor(rand() * clues.length)
  return clues.map((c, i) => i !== at ? c : {
    on: holder.label,
    item_id: holder.id,
    text: t('carried_mark', { clue: c.text }),
  })
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
  const surfaces = surfacesOf(scene, lang)
  if (!surfaces.length) return null

  if (kind === 'frequency') {
    // UNE SEULE VALEUR, ÉCRITE EN CLAIR sur une chose du lieu. Trois indices à
    // combiner (fourchette, parité, somme des chiffres) rendaient la première
    // énigme de la nuit trop dure : il suffit de trouver où elle est écrite.
    // Elle reste dans le lieu — jamais sur un objet porté.
    const solution = 20 + Math.floor(rand() * 80)
    return {
      kind,
      solution,
      min: 10,
      max: 99,
      clues: spread([t('freq_value', { value: solution })], surfaces, rand),
    }
  }

  if (kind === 'code') {
    // Deux morceaux de deux chiffres, différents, et la seule consigne qui
    // dise lequel vient d'abord. Chaque morceau seul ne sert à rien.
    let a = 0
    let b = 0
    while (a === b) {
      a = Math.floor(rand() * 100)
      b = Math.floor(rand() * 100)
    }
    const pad = (n: number) => String(n).padStart(2, '0')
    const lowFirst = rand() < 0.5
    const [first, second] = lowFirst ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)]
    return {
      kind,
      solution: `${pad(first)}${pad(second)}`,
      clues: carryOne(spread([
        t('code_fragment', { digits: pad(a) }),
        t('code_fragment', { digits: pad(b) }),
        t(lowFirst ? 'code_order_low' : 'code_order_high'),
      ], surfaces, rand), opts.carried, rand, t),
    }
  }

  if (kind === 'sequence') {
    // Les gestes viennent du modèle — ce sont ceux du dénouement de CE joueur.
    // L'ordre, lui, se donne par paires : chaque consigne ne lie que deux
    // gestes voisins, et il faut les trois pour tout remettre en place.
    const steps = (scene.key_item?.steps ?? []).map(s => s?.trim()).filter((s): s is string => Boolean(s))
    if (steps.length < 3 || steps.length > 5 || new Set(steps.map(fold)).size !== steps.length) return null
    let display = shuffle(steps.map((_, i) => i), rand)
    // Présentée déjà dans l'ordre, elle serait résolue avant d'être lue.
    if (display.every((v, i) => v === i)) display = [...display.slice(1), display[0]!]
    const clues = steps.slice(1).map((later, i) => t('seq_after', { later, earlier: steps[i]! }))
    return {
      kind,
      steps: display.map(i => steps[i]!),
      solution: steps.map((_, i) => display.indexOf(i)),
      clues: carryOne(spread(shuffle(clues, rand), surfaces, rand), opts.carried, rand, t),
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
    // LA RÉPONSE EST UNE CARTE QU'UN LIEU A DÉLIVRÉE. Sa couleur est l'accent
    // de ce lieu, et c'est ce que l'indice rappelle ; les cartes ramassées en
    // plus ont une autre couleur, elles sont là pour qu'il faille choisir. Une
    // couleur portée deux fois ne peut pas être la réponse : l'indice ne
    // saurait pas laquelle désigner.
    const twice = (c: CarriedItem) => cards.filter(o => fold(o.color!) === fold(c.color!)).length > 1
    const answers = cards.filter(c => c.id.startsWith('cle_') && !twice(c))
    if (!answers.length) return null
    const card = answers[Math.floor(rand() * answers.length)]!
    const focal = surfaces.find(s => s.id === 'decor:focal') ?? surfaces[0]!
    // LE LECTEUR DÉCRIT, IL NE NOMME PAS. Ce que le joueur a vu dominer ce
    // lieu-là, s'il reste au journal ; sinon le nom du lieu, comme avant. Le
    // rapprochement, c'est à lui de le faire : le jeu ne se souvient pas à sa
    // place de l'endroit où il a pris quoi.
    const seen = opts.journal?.find(e => e.place_name === card.from)?.focal
    return {
      kind,
      card_id: card.id,
      place: card.from!,
      clues: [{
        on: focal.label,
        text: seen ? t('lock_clue_recall', { focal: seen }) : t('lock_clue', { place: card.from! }),
      }],
    }
  }

  if (kind === 'search') {
    // Chaque endroit, regardé, en innocente un AUTRE. Aucun ne se désigne
    // lui-même : il faut en avoir lu plusieurs pour savoir où plonger la main.
    // Le lointain se regarde mais ne se fouille pas.
    const spots = shuffle(surfaces.filter(s => !s.far), rand).slice(0, 4)
    if (spots.length < 3) return null
    const solution = spots[Math.floor(rand() * spots.length)]!
    const empty = spots.filter(s => s !== solution)
    const clues: PuzzleClue[] = empty.map((spot, i) => ({
      on: spot.label,
      text: t('search_still', { spot: empty[(i + 1) % empty.length]!.label }),
    }))
    clues.push({ on: solution.label, text: t('search_still', { spot: empty[0]!.label }) })
    return {
      kind,
      spots: spots.map(s => ({ id: s.id, label: s.label })),
      solution: solution.id,
      clues,
    }
  }

  return null
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
