/**
 * Ce que partagent les réseaux de /nimda/socials : la forme d'un réseau (ses
 * formats, son état, sa publication), les jetons OAuth gardés dans le stockage
 * local comme celui de TikTok Ads, et le journal des publications.
 *
 * Chaque réseau vit dans son fichier (meta.ts pour Instagram et Facebook,
 * tiktok.ts, youtube.ts, x.ts) ; index.ts les range dans l'ordre des onglets.
 * Les identifiants d'app sont au .env local seulement ; les jetons obtenus en
 * branchant un compte vont dans `.data/kv/socials`, jamais au .env.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'

export type Kind = 'image' | 'video'
/** Un média reçu de la page : le fichier lui-même, ou une adresse publique que le réseau ira chercher. */
export type Media = { name: string; type: string; kind: Kind; data?: Buffer; url?: string }

export type Option =
  | { id: string; label: string; type: 'check'; default: boolean }
  | { id: string; label: string; type: 'select'; default: string; choices: { value: string; label: string }[] }
  | { id: string; label: string; type: 'text'; default: string }
  | { id: string; label: string; type: 'lines'; default: string }

/** Ce que la page doit demander pour un format : elle se dessine d'après lui. */
export type Format = {
  id: string
  label: string
  /** Légende, message ou description ; absent quand le format n'a pas de texte. */
  text?: { label: string; max: number; required?: boolean }
  title?: { label: string; max: number; required?: boolean }
  /** `urls` : le réseau accepte des adresses publiques ; `files` : des fichiers du poste. */
  media?: { kinds: Kind[]; min: number; max: number; files: boolean; urls: boolean }
  options?: Option[]
  note?: string
}

export type Draft = { format: string; text: string; title: string; media: Media[]; options: Record<string, string | boolean> }
export type Result = { ref: string; url?: string; state: 'done' | 'pending'; detail?: string }

/** Une ligne de l'état : `fix` se répare d'un clic, `connect` demande de rebrancher le compte. */
export type Check = {
  id: string
  label: string
  state: 'ok' | 'warn' | 'bad' | 'off'
  detail: string
  fix?: 'refresh' | 'pending' | 'forget'
  connect?: boolean
}

export type Entry = {
  id: string
  at: string
  network: string
  format: string
  excerpt: string
  ref: string
  url?: string
  state: 'done' | 'pending' | 'failed'
  detail?: string
}

export type Setup = { env: string[]; steps: string[]; redirect?: string; oauth: boolean }

export type Network = {
  id: string
  label: string
  formats: Format[]
  /** `port` : celui du serveur de dev, pour les adresses de retour en local. */
  setup(port: string): Setup
  /** Les identifiants d'app sont au .env. */
  ready(): boolean
  connected(): Promise<boolean>
  authorize?(port: string): Promise<string>
  connect?(code: string, pending: Pending): Promise<void>
  scan(): Promise<{ account?: string; checks: Check[] }>
  repair(fix: 'refresh' | 'forget'): Promise<string>
  publish(draft: Draft): Promise<Result>
  /** Relit une publication restée en cours ; `act` l'achève quand le réseau attend un geste (Instagram). */
  follow?(entry: Entry, act: boolean): Promise<Partial<Entry>>
}

export const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Le message d'erreur du réseau, où qu'il le range. */
function reason(body: unknown, fallback: string) {
  const b = body as Record<string, any> | null
  const msg = b?.error?.message ?? b?.error_description ?? b?.detail ?? b?.errors?.[0]?.message
    ?? b?.title ?? b?.message ?? (typeof b?.error === 'string' ? b.error : null)
  // Meta range l'explication lisible à part : « Permissions error » seul ne dit pas quoi faire.
  const hint = b?.error?.error_user_msg ? ` — ${b.error.error_user_msg}` : ''
  return (String(msg ?? fallback) + hint).slice(0, 400)
}

type Init = Omit<RequestInit, 'body'> & {
  body?: BodyInit
  query?: Record<string, unknown>
  json?: unknown
  form?: Record<string, string>
}

/** Un appel brut : lève une 502 lisible si le réseau refuse. */
export async function request(label: string, url: string, init: Init = {}) {
  const { query, json, form, ...rest } = init
  const u = new URL(url)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  const headers = new Headers(rest.headers)
  let body = rest.body
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json; charset=UTF-8')
    body = JSON.stringify(json)
  } else if (form) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    body = new URLSearchParams(form).toString()
  }
  let res: Response
  try {
    res = await fetch(u, { ...rest, headers, body, signal: AbortSignal.timeout(15 * 60_000) })
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `${label} : ${(e as Error).message}` })
  }
  if (!res.ok) {
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {}
    throw createError({ statusCode: 502, statusMessage: `${label} : ${reason(parsed, text || `HTTP ${res.status}`)}` })
  }
  return res
}

export async function http<T>(label: string, url: string, init: Init = {}): Promise<T> {
  const text = await (await request(label, url, init)).text()
  return (text ? JSON.parse(text) : {}) as T
}

/** Les octets d'un média : le réseau qui ne prend que des fichiers reçoit l'adresse téléchargée ici. */
export async function bytes(m: Media) {
  if (m.data) return m.data
  return Buffer.from(await (await request('Téléchargement', m.url!)).arrayBuffer())
}

/** Un Buffer en morceau de corps de requête, sans que TypeScript bute sur son ArrayBuffer partagé. */
export const blob = (data: Buffer, type?: string) => new Blob([new Uint8Array(data)], { type })

export const bad = (statusMessage: string) => createError({ statusCode: 400, statusMessage })

/* Jetons OAuth */

export type Saved = {
  access: string
  refresh?: string
  /** Millisecondes. */
  expiresAt?: number
  refreshExpiresAt?: number
  scope: string[]
  at: string
}
/** Ce qu'un aller-retour d'autorisation laisse en attente : le réseau, l'adresse de retour exacte, le vérificateur PKCE. */
export type Pending = { network: string; redirect: string; verifier: string; at: string }

const storage = () => useStorage('data')
const tokenKey = (id: string) => `socials:token:${id}`

export const loadToken = (id: string) => storage().getItem<Saved>(tokenKey(id))
export const saveToken = (id: string, saved: Saved) => storage().setItem(tokenKey(id), saved)
export const forgetToken = (id: string) => storage().removeItem(tokenKey(id))

/** Ouvre un aller-retour : le `state` porte le réseau et un jeton d'une heure. */
export async function openState(network: string, redirect: string) {
  const nonce = randomBytes(12).toString('hex')
  const pending: Pending = { network, redirect, verifier: randomBytes(32).toString('base64url'), at: new Date().toISOString() }
  await storage().setItem(`socials:oauth:${nonce}`, pending)
  return { state: `${network}.${nonce}`, challenge: createHash('sha256').update(pending.verifier).digest('base64url'), pending }
}

export async function takeState(state: string) {
  const nonce = state.split('.')[1] ?? ''
  if (!/^[0-9a-f]{24}$/.test(nonce)) return null
  const key = `socials:oauth:${nonce}`
  const pending = await storage().getItem<Pending>(key)
  await storage().removeItem(key)
  if (!pending || Date.now() - Date.parse(pending.at) > 3600_000) return null
  return pending
}

export type OAuth = {
  id: string
  label: string
  scopes: string[]
  redirect(port: string): string
  url(p: { redirect: string; state: string; challenge: string }): string
  exchange(code: string, pending: Pending): Promise<Saved>
  refresh(saved: Saved): Promise<Saved>
}

/** Le tronc commun des réseaux branchés par OAuth : brancher, garder le jeton frais, le diagnostiquer. */
export function oauth(o: OAuth) {
  async function token() {
    const saved = await loadToken(o.id)
    if (!saved) throw bad(`${o.label} : compte à brancher (onglet Info ou bouton Brancher)`)
    if (saved.expiresAt && saved.expiresAt - 60_000 < Date.now() && saved.refresh) {
      const fresh = await o.refresh(saved)
      await saveToken(o.id, fresh)
      return fresh.access
    }
    return saved.access
  }

  async function checks(): Promise<Check[]> {
    const saved = await loadToken(o.id)
    if (!saved) return [{ id: 'token', label: 'Compte', state: 'bad', detail: 'pas encore branché', connect: true }]
    const out: Check[] = []
    const day = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })
    if (!saved.expiresAt) out.push({ id: 'token', label: 'Jeton', state: 'ok', detail: `branché le ${day(Date.parse(saved.at))}` })
    else if (saved.expiresAt < Date.now()) {
      out.push(saved.refresh
        ? { id: 'token', label: 'Jeton', state: 'warn', detail: `expiré le ${day(saved.expiresAt)}, renouvelable`, fix: 'refresh' }
        : { id: 'token', label: 'Jeton', state: 'bad', detail: `expiré le ${day(saved.expiresAt)}`, connect: true })
    } else out.push({ id: 'token', label: 'Jeton', state: 'ok', detail: `valable jusqu’au ${day(saved.expiresAt)}`, fix: saved.refresh ? 'refresh' : undefined })
    if (saved.refreshExpiresAt) {
      const left = saved.refreshExpiresAt - Date.now()
      out.push({
        id: 'refresh', label: 'Renouvellement',
        state: left < 0 ? 'bad' : left < 14 * 86400_000 ? 'warn' : 'ok',
        detail: left < 0 ? 'plus renouvelable : rebrancher' : `possible jusqu’au ${day(saved.refreshExpiresAt)}`,
        connect: left < 14 * 86400_000,
      })
    }
    const missing = o.scopes.filter(s => !saved.scope.includes(s))
    out.push(missing.length
      ? { id: 'scope', label: 'Permissions', state: 'bad', detail: `manquent ${missing.join(', ')}`, connect: true }
      : { id: 'scope', label: 'Permissions', state: 'ok', detail: o.scopes.join(', ') })
    return out
  }

  return {
    token,
    checks,
    connected: async () => !!(await loadToken(o.id)),
    async authorize(port: string) {
      const redirect = o.redirect(port)
      const { state, challenge } = await openState(o.id, redirect)
      return o.url({ redirect, state, challenge })
    },
    async connect(code: string, pending: Pending) {
      await saveToken(o.id, await o.exchange(code, pending))
    },
    async repair(fix: 'refresh' | 'forget') {
      if (fix === 'forget') {
        await forgetToken(o.id)
        return `${o.label} : jeton oublié, à rebrancher`
      }
      const saved = await loadToken(o.id)
      if (!saved?.refresh) throw bad(`${o.label} : rien à renouveler, rebrancher le compte`)
      await saveToken(o.id, await o.refresh(saved))
      return `${o.label} : jeton renouvelé`
    },
  }
}

/* Journal des publications */

const JOURNAL_KEY = 'socials:journal'
const JOURNAL_MAX = 60

export const journal = async () => (await storage().getItem<Entry[]>(JOURNAL_KEY)) ?? []

export async function record(e: Omit<Entry, 'id' | 'at'>) {
  const entry: Entry = { id: randomUUID(), at: new Date().toISOString(), ...e }
  await storage().setItem(JOURNAL_KEY, [entry, ...(await journal())].slice(0, JOURNAL_MAX))
  return entry
}

/** Les relectures arrivent ensemble et s'écrivent d'un coup : deux écritures croisées perdraient l'une d'elles. */
export async function amend(patches: Map<string, Partial<Entry>>) {
  if (!patches.size) return
  const list = await journal()
  await storage().setItem(JOURNAL_KEY, list.map(e => patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e))
}

export const failure = (e: unknown) => {
  const err = e as { statusMessage?: string; message?: string }
  return err.statusMessage ?? err.message ?? 'échec'
}
