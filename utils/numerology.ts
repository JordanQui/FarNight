/**
 * Numérologie indienne, à partir de la date de naissance et du nom.
 *
 * Trois nombres, trois rôles distincts :
 *  - moolank (मूलांक), « nombre psychique » : réduction du JOUR de naissance.
 *    C'est ce que la nuit oppose au joueur : le terrain de ses situations,
 *    jamais sa manière d'agir — le joueur reste libre de ses gestes.
 *  - bhagyank (भाग्यांक), « nombre de destinée » : réduction de la date ENTIÈRE.
 *    C'est la forme que prend l'objectif.
 *  - namank, « nombre du nom » : valeur chaldéenne des lettres du PRÉNOM —
 *    le nom par lequel on est appelé. C'est la façon dont le monde reçoit le
 *    joueur.
 *  - full_namank : le même calcul sur le NOM COMPLET, prénom et nom de famille
 *    réunis. C'est l'héritage : ce que le nom traîne avant qu'on ait parlé.
 *    Deux joueurs prénommés pareil n'ont donc pas la même nuit.
 *
 * Comme utils/zodiac.ts, ce fichier ne contient AUCUN texte de jeu : il ne
 * produit que des nombres. Leur sens vit dans game/script.json.
 */

import { parseBirthday } from '~/utils/zodiac'

/**
 * Table chaldéenne, celle qu'emploie la numérologie indienne — et non la table
 * pythagoricienne. Le 9 n'y est jamais attribué à une lettre : il était tenu
 * pour sacré.
 */
const CHALDEAN: Record<string, number> = {
  A: 1, I: 1, J: 1, Q: 1, Y: 1,
  B: 2, K: 2, R: 2,
  C: 3, G: 3, L: 3, S: 3,
  D: 4, M: 4, T: 4,
  E: 5, H: 5, N: 5, X: 5,
  U: 6, V: 6, W: 6,
  O: 7, Z: 7,
  F: 8, P: 8,
}

export interface NumerologyProfile {
  /** Ce que la nuit oppose au joueur. Réduction du jour de naissance. */
  moolank: number
  /** Forme de l'objectif. Réduction de la date entière. */
  bhagyank: number | null
  /** Façon dont le monde reçoit le joueur. Valeur du PRÉNOM. */
  namank: number | null
  /** Ce que son nom traîne. Valeur du nom complet, prénom et nom réunis. */
  full_namank: number | null
}

/** Réduit à un chiffre de 1 à 9. */
function reduce(n: number): number {
  let value = Math.abs(n)
  while (value > 9) {
    value = String(value).split('').reduce((sum, digit) => sum + Number(digit), 0)
  }
  return value === 0 ? 9 : value
}

/**
 * Abjad : les valeurs des lettres arabes, la numérologie que l'arabe pratique
 * depuis toujours (أبجد هوز حطي…). Plus juste qu'une translittération : un nom
 * arabe se pèse dans son alphabet, et les voyelles brèves n'y comptent pas.
 */
const ABJAD: Record<string, number> = {
  ا: 1, ب: 2, ج: 3, د: 4, ه: 5, و: 6, ز: 7, ح: 8, ط: 9,
  ي: 10, ك: 20, ل: 30, م: 40, ن: 50, س: 60, ع: 70, ف: 80, ص: 90,
  ق: 100, ر: 200, ش: 300, ت: 400, ث: 500, خ: 600, ذ: 700, ض: 800, ظ: 900, غ: 1000,
}

/** Les formes dérivées ramenées à leur lettre : la hamza et ses supports, la tâ marbûta. */
const ABJAD_FOLD: Record<string, string> = {
  أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ء: 'ا', ؤ: 'و', ئ: 'ي', ى: 'ي', ة: 'ه',
}

/**
 * Le cyrillique en lettres latines : la translittération est mécanique, et la
 * table chaldéenne s'applique ensuite telle quelle.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}

/**
 * Les kana en rōmaji (Hepburn). Les kanji, eux, n'ont pas de lecture unique :
 * un nom qui en contient demande sa forme latine au joueur.
 */
const KANA: Record<string, string> = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
  ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
  ワ: 'wa', ヲ: 'o', ン: 'n', ヴ: 'vu',
}
const SMALL_Y: Record<string, string> = { ャ: 'a', ュ: 'u', ョ: 'o' }
const SMALL_VOWEL: Record<string, string> = { ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' }

function romaji(kana: string): string {
  // Les hiragana rejoignent les katakana : même table, décalage fixe.
  const chars = [...kana].map((ch) => {
    const code = ch.charCodeAt(0)
    return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : ch
  })
  let out = ''
  let double = false
  for (const ch of chars) {
    if (ch === 'ッ') { double = true; continue }
    if (ch === 'ー') continue
    if (SMALL_Y[ch] && out.endsWith('i')) {
      // キャ → kya, シャ → sha, チャ → cha, ジャ → ja
      out = /(sh|ch|j)i$/.test(out)
        ? out.slice(0, -1) + SMALL_Y[ch]
        : out.slice(0, -1) + 'y' + SMALL_Y[ch]
      continue
    }
    if (SMALL_VOWEL[ch] && out) { out = out.replace(/[aiueo]$/, '') + SMALL_VOWEL[ch]; continue }
    const piece = KANA[ch] ?? SMALL_Y[ch] ?? SMALL_VOWEL[ch] ?? ''
    out += double && piece ? piece[0] + piece : piece
    double = false
  }
  return out
}

const HAS_LATIN = /[A-Za-z\u00C0-\u024F]/
const ARABIC = /\p{Script=Arabic}/u
const CYRILLIC_RE = /\p{Script=Cyrillic}/u
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s・]+$/u

/** Retire accents, espaces et ponctuation : la table ne connaît que A-Z. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
}

function chaldean(latin: string): number | null {
  let total = 0
  for (const letter of normalizeName(latin)) total += CHALDEAN[letter] ?? 0
  return total > 0 ? total : null
}

function abjad(arabic: string): number | null {
  let total = 0
  for (const ch of arabic.replace(/[\u064B-\u065F\u0670\u0640]/g, '')) {
    total += ABJAD[ABJAD_FOLD[ch] ?? ch] ?? 0
  }
  return total > 0 ? total : null
}

/**
 * La somme brute d'un nom, avant réduction, dans la tradition de son écriture.
 *
 * Latin : table chaldéenne. Arabe : abjad. Cyrillique et kana : translittérés,
 * puis chaldéens. Le chinois et les kanji n'ont pas de lecture qu'on puisse
 * tirer du caractère seul : il leur faut `latin`, la forme que le joueur a
 * déclarée lui-même (pinyin, rōmaji). Sans elle, null — le signe prend le
 * relais, comme pour un dossier sans nom.
 *
 * Une SOMME et non un nombre réduit : le nom complet est la somme du prénom
 * et du nom, ce qui permet de peser chacun dans sa propre écriture.
 */
export function nameTotal(name?: string, latin?: string): number | null {
  if (latin && HAS_LATIN.test(latin)) return chaldean(latin)
  if (!name?.trim()) return null
  const text = name.normalize('NFC')
  if (HAS_LATIN.test(text)) return chaldean(text)
  if (ARABIC.test(text)) return abjad(text)
  if (CYRILLIC_RE.test(text)) return chaldean([...text.toLowerCase()].map(ch => CYRILLIC[ch] ?? ch).join(''))
  if (KANA_ONLY.test(text)) return chaldean(romaji(text))
  return null
}

/** Le nom se pèse-t-il sans aide ? Sinon, le formulaire demande sa forme latine. */
export function needsLatinName(name?: string): boolean {
  return Boolean(name?.trim()) && nameTotal(name) === null
}

export function namankOf(name?: string, latin?: string): number | null {
  const total = nameTotal(name, latin)
  return total ? reduce(total) : null
}

/**
 * Le profil numérologique complet.
 *
 * `bhagyank` reste null quand l'année de naissance manque : il lui faut la
 * date entière, contrairement au moolank qui ne dépend que du jour.
 */
/**
 * @param firstName le PRÉNOM — celui par lequel on appelle le joueur.
 * @param lastName le nom de famille. Omis, l'héritage reste null : un dossier
 * sans nom de famille ne doit pas retomber sur le prénom, sans quoi réception
 * et héritage diraient exactement la même chose.
 * @param latin leur forme en lettres latines, quand l'écriture du nom n'en
 * donne pas de lecture (chinois, kanji).
 */
export function numerologyOf(
  birthday?: string,
  firstName?: string,
  lastName?: string,
  latin?: { first?: string; last?: string },
): NumerologyProfile | null {
  const date = parseBirthday(birthday)
  const first = nameTotal(firstName, latin?.first)
  const last = lastName ? nameTotal(lastName, latin?.last) : null
  const namank = first ? reduce(first) : null
  // L'héritage veut les DEUX moitiés : un nom de famille illisible ne doit pas
  // laisser le prénom seul se faire passer pour le nom entier.
  const full_namank = first && last ? reduce(first + last) : null
  if (!date && namank === null && full_namank === null) return null

  if (!date) return { moolank: 0, bhagyank: null, namank, full_namank }

  const year = extractYear(birthday)
  const digitsOf = (n: number) => String(n).split('').reduce((s, d) => s + Number(d), 0)

  return {
    moolank: reduce(date.day),
    bhagyank: year === null
      ? null
      : reduce(digitsOf(date.day) + digitsOf(date.month) + digitsOf(year)),
    namank,
    full_namank,
  }
}

function extractYear(birthday?: string): number | null {
  if (!birthday) return null
  const raw = birthday.trim()

  const parts = raw.includes('/') ? raw.split('/') : raw.split('-')
  // `MM/DD/YYYY` met l'année en dernier, `YYYY-MM-DD` en premier.
  const candidate = raw.includes('/') ? parts[2] : parts[0]
  if (parts.length !== 3) return null

  const year = Number(candidate)
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null
}
