/**
 * Découpage d'un texte autour des noms à chiffrer.
 *
 * Les noms ne sont jamais lisibles dans le récit : ils sont recouverts d'une
 * animation de lettres qui bougent, et seul l'oeil bionique les révèle. Pour
 * les rendre autrement que le reste, il faut d'abord savoir où ils commencent
 * et où ils finissent.
 */

/**
 * Une identité ne se brouille pas comme une chose : le rendu diffère.
 *
 * `mark` ne se brouille pas du tout : c'est un nom en clair qu'on touche, mis
 * en gras dans les écritures sans casse, où le gras tient lieu de majuscule.
 */
export type TermKind = 'name' | 'object' | 'mark'

export interface Term {
  value: string
  kind: TermKind
  /**
   * L'identité de la chose, pour un terme `object`.
   *
   * C'est elle qui décide de ce qui est déchiffré : sans elle, tous les objets
   * d'une scène partageaient l'id de l'objet scellé, et réussir une épreuve les
   * révélait tous d'un coup.
   */
  id?: string
}

export interface TextSegment {
  text: string
  /** Renseigné si ce fragment est un terme à chiffrer. */
  name?: string
  /** Nature du terme, pour choisir le composant de rendu. */
  kind?: TermKind
  /** L'identité de la chose, reportée depuis le terme. */
  id?: string
  /** Position du fragment dans le texte d'origine, pour la frappe progressive. */
  start: number
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Découpe le texte en fragments ordinaires et fragments-noms.
 *
 * Les noms les plus longs sont testés en premier : sinon « Seru » masquerait
 * « Serumito », dont il est un préfixe.
 */
export function splitByNames(text: string, terms: Array<string | Term>): TextSegment[] {
  const normalized: Term[] = terms.map(t => (typeof t === 'string' ? { value: t, kind: 'name' } : t))
  const usable = normalized
    .filter(t => t.value.trim().length > 1)
    .sort((a, b) => b.value.length - a.value.length)

  if (!usable.length) return [{ text, start: 0 }]

  // Insensible à la casse : le modèle écrit « la Carte Ambre » en début de
  // phrase et « la carte ambre » plus loin. Une correspondance exacte laissait
  // alors la moitié des occurrences en clair, sans qu'on comprenne pourquoi.
  const byValue = new Map(usable.map(t => [t.value.toLowerCase(), t]))
  const pattern = new RegExp(`(${usable.map(t => escapeRegex(t.value)).join('|')})`, 'gi')
  const segments: TextSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > cursor) segments.push({ text: text.slice(cursor, at), start: cursor })
    const term = byValue.get(match[0].toLowerCase())
    segments.push({
      text: match[0],
      // LA FORME CANONIQUE, pas celle que le texte a écrite.
      //
      // La correspondance est insensible à la casse, et le récit récite
      // volontiers les noms en capitales dans sa dernière ligne. Le fragment
      // portait alors « KARU » là où la fiche dit « Karu » : le nom s'affichait
      // en capitales une fois déchiffré, et surtout `voiceOfName` ne le
      // retrouvait plus dans la distribution des voix — il tombait sur le mode
      // de repli, et le même personnage n'avait pas la même musique selon
      // l'endroit du texte où on le survolait.
      name: term?.value ?? match[0],
      kind: term?.kind ?? 'name',
      id: term?.id,
      start: at,
    })
    cursor = at + match[0].length
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), start: cursor })
  return segments
}

/**
 * Alphabet du brouillage.
 *
 * Volontairement latin : des runes ou des symboles mathématiques ont des
 * largeurs très différentes des lettres, et le nom changeait de taille à chaque
 * cycle — ce qui faisait danser tout le paragraphe.
 */
const NOISE = '#%@&$§?!*+=/\\|<>~^ABCDEFGHJKLMNPQRSTUVWXZ0123456789'

/**
 * Le même bruit en pleine chasse, pour les idéogrammes et les kana : un signe
 * latin y occupe une demi-case, et le nom rétrécissait de moitié en se
 * brouillant.
 */
const WIDE_NOISE = '＃％＠＆＄？！＊＋＝／＜＞～ＡＢＣＤＥＦＧＨＪＫＬＭＮＰＱＲＳＴＵＶＷＸＺ０１２３４５６７８９'

/** Le bruit arabe : des lettres arabes, pour que le nom garde sa ligature et son sens. */
const ARABIC_NOISE = 'ءبتثجحخدذرزسشصضطظعغفقكلمنهوي٠١٢٣٤٥٦٧٨٩'

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u
const ARABIC = /\p{Script=Arabic}/u

/** Une chaîne de bruit de la même longueur, pour que la mise en page ne bouge pas. */
export function scramble(source: string, seed: number): string {
  let out = ''
  for (let i = 0; i < source.length; i++) {
    // Les espaces restent des espaces : sinon deux noms n'en font plus qu'un.
    if (source[i] === ' ') { out += ' '; continue }
    const ch = source[i]!
    const alphabet = WIDE.test(ch) ? WIDE_NOISE : ARABIC.test(ch) ? ARABIC_NOISE : NOISE
    out += alphabet[(seed * 31 + i * 17 + source.charCodeAt(i)) % alphabet.length]
  }
  return out
}
