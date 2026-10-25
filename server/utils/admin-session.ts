import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { requireSecret } from '~/server/utils/runtime-secrets'

/**
 * La session d'admin en production : un cookie signé, ouvert par le mot de
 * passe (`NUXT_ADMIN_PASSWORD`). Sans lui, aucun mot de passe n'ouvre : un
 * oubli ne doit jamais rien ouvrir.
 *
 * La clé de signature mêle NUXT_SECRET et le mot de passe : en changer un
 * ferme toutes les sessions ouvertes.
 */

const ADMIN_COOKIE = 'fn_admin'
const SESSION_DAYS = 30

function password(): string {
  return (useRuntimeConfig().adminPassword || process.env.NUXT_ADMIN_PASSWORD || '').trim()
}

function key(): string {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  return `${secret}:${createHash('sha256').update(password()).digest('hex')}`
}

const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url')

/** Comparaison à temps constant, sur des empreintes de même longueur. */
function same(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function passwordMatches(candidate: unknown): boolean {
  return typeof candidate === 'string' && password() !== '' && same(candidate.trim(), password())
}

export function openAdminSession(event: H3Event): void {
  const expires = String(Date.now() + SESSION_DAYS * 86_400_000)
  setCookie(event, ADMIN_COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export function closeAdminSession(event: H3Event): void {
  deleteCookie(event, ADMIN_COOKIE, { path: '/' })
}

export function hasAdminSession(event: H3Event): boolean {
  const raw = getCookie(event, ADMIN_COOKIE)
  if (!raw) return false
  const dot = raw.indexOf('.')
  if (dot < 1) return false
  const expires = raw.slice(0, dot)
  return same(sign(expires), raw.slice(dot + 1)) && Number(expires) > Date.now()
}
