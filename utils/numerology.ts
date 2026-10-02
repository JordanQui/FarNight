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

/** Retire accents, espaces et ponctuation : la table ne connaît que A-Z. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
}

export function namankOf(name?: string): number | null {
  if (!name) return null
  const letters = normalizeName(name)
  if (!letters) return null

  let total = 0
  for (const letter of letters) total += CHALDEAN[letter] ?? 0
  return total > 0 ? reduce(total) : null
}

/**
 * Le profil numérologique complet.
 *
 * `bhagyank` reste null quand l'année de naissance manque : il lui faut la
 * date entière, contrairement au moolank qui ne dépend que du jour.
 */
/**
 * @param name le PRÉNOM — celui par lequel on appelle le joueur.
 * @param fullName prénom et nom de famille. Omis, l'héritage reste null : un
 * dossier sans nom de famille ne doit pas retomber sur le prénom, sans quoi
 * réception et héritage diraient exactement la même chose.
 */
export function numerologyOf(
  birthday?: string, name?: string, fullName?: string,
): NumerologyProfile | null {
  const date = parseBirthday(birthday)
  const namank = namankOf(name)
  const full_namank = namankOf(fullName)
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
