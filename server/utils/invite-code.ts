import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Code d'invitation, tiré de l'adresse e-mail.
 *
 * Une nuit offerte sans base de données : le code est la signature de
 * l'adresse, tronquée. Le serveur la recalcule et compare, il n'a rien à
 * retenir. Seul qui détient NUXT_SECRET peut en fabriquer un — c'est
 * la page /admin/encrypt.
 *
 * L'alphabet écarte I, O, 0 et 1 : le code se recopie à la main.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LENGTH = 8

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function inviteCode(email: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(`invite:${normalizeEmail(email)}`).digest()
  return Array.from(digest.subarray(0, LENGTH), byte => ALPHABET[byte % ALPHABET.length]).join('')
}

/** Tirets, espaces et casse ne comptent pas : seul le code compte. */
export function inviteMatches(email: string, code: string, secret: string): boolean {
  const expected = Buffer.from(inviteCode(email, secret))
  const received = Buffer.from(code.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  return expected.length === received.length && timingSafeEqual(expected, received)
}
