import type { LangCode } from '~/types/i18n'
import type { InterfaceSource } from '~/utils/ui-theme'
import { nightOf, type JournalEntry } from '~/utils/journal'
import { resolveLang } from '~/utils/languages'
import { sanitizeHtml } from '~/utils/sanitize-html'

/**
 * Le carnet de la nuit : ce que le PDF offert sur l'écran de fin met en pages.
 *
 * Rien n'y est généré. C'est la partie déjà jouée, relue — le but, les lieux,
 * les réponses trouvées, ce qu'il emporte, le texte de fin et son aube. Le
 * serveur ne tient aucune base : tout part du navigateur, qui le garde avec
 * l'écran de fin, pour que l'offre survive au rechargement tant que la ville
 * reste fermée.
 */
export interface KeepsakePlace {
  place: string
  title: string
  /** Ce qui s'y est joué : l'objectif de la scène. */
  played: string
  who: string[]
  carried: string | null
  answer?: string
}

export interface Keepsake {
  lang: LangCode
  /** Le prénom, comme le jeu l'interpelle. */
  name: string
  /** Le jour où l'aube s'est levée, écrit par le navigateur : dans sa langue et son fuseau. */
  date: string
  /** Le titre de la nuit, fixé à l'auberge — à défaut, celui de l'épilogue. */
  title: string
  goal?: string
  places: KeepsakePlace[]
  augmentation?: string
  /** Les objets qu'il garde, ceux dont il a lu le nom. */
  kept: string[]
  ending_html: string
  /** L'aube en JPEG : l'originale pèse trop lourd pour repartir au serveur. */
  image?: string
  /** La palette de l'aube : le PDF prend les couleurs de l'écran de fin. */
  palette: InterfaceSource
}

/** Les lieux du journal, sans les notes d'auteur qu'il transporte aussi. */
export function placesOf(journal: JournalEntry[]): KeepsakePlace[] {
  return journal.map(e => ({
    place: e.place_name,
    title: e.scene_title,
    played: e.what_changed,
    who: e.who_mattered,
    carried: e.carried,
    answer: e.answer,
  }))
}

/** Le titre et le but de la nuit, tels que l'auberge les a fixés. */
export function nightHeadOf(journal: JournalEntry[]): { title?: string; goal?: string } {
  const night = nightOf(journal)
  return { title: night?.title, goal: night?.goal }
}

/**
 * L'aube repassée en JPEG.
 *
 * L'image arrive en base64 de plusieurs mégaoctets : telle quelle, elle
 * saturerait le stockage du navigateur et dépasserait ce que Vercel accepte en
 * entrée. Un échec la laisse hors du PDF, qui tient sans elle.
 */
export async function asJpeg(dataUrl: string): Promise<string | undefined> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')?.drawImage(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return undefined
  }
}

/**
 * Le carnet tel que le navigateur l'envoie, borné et nettoyé.
 *
 * Il finit dans une page que Chrome imprime : tout y entre comme du texte, sauf
 * le texte de fin, repassé par la liste blanche — il revient du navigateur, le
 * filtrage fait à sa génération ne garantit plus rien.
 */
export function clampKeepsake(input: unknown): Keepsake | null {
  if (!input || typeof input !== 'object') return null
  const k = input as Partial<Keepsake>
  const cut = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const hex = (v: unknown, fallback: string) =>
    (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback)

  const ending = sanitizeHtml(cut(k.ending_html, 12_000))
  if (!ending) return null

  const image = typeof k.image === 'string' && k.image.length < 3_000_000
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(k.image)
    ? k.image
    : undefined

  return {
    lang: resolveLang(k.lang),
    name: cut(k.name, 60),
    date: cut(k.date, 60),
    title: cut(k.title, 120),
    goal: cut(k.goal, 400) || undefined,
    places: (Array.isArray(k.places) ? k.places : []).slice(0, 12).map(p => ({
      place: cut(p?.place, 120),
      title: cut(p?.title, 120),
      played: cut(p?.played, 400),
      who: (Array.isArray(p?.who) ? p.who : []).slice(0, 6).map(n => cut(n, 60)).filter(Boolean),
      carried: cut(p?.carried, 120) || null,
      answer: cut(p?.answer, 200) || undefined,
    })),
    augmentation: cut(k.augmentation, 80) || undefined,
    kept: (Array.isArray(k.kept) ? k.kept : []).slice(0, 24).map(n => cut(n, 80)).filter(Boolean),
    ending_html: ending,
    image,
    palette: {
      dominant: { hex: hex(k.palette?.dominant?.hex, '#0E1420') },
      secondary: { hex: hex(k.palette?.secondary?.hex, '#46536E') },
      accent: { hex: hex(k.palette?.accent?.hex, '#FF2E88') },
    },
  }
}

/**
 * Gardé à part de la partie, et sur la même durée que la fermeture de fin :
 * passé ce délai la ville rouvre sur l'accueil, et l'offre n'a plus d'écran.
 */
const KEEPSAKE_KEY = 'tg_keepsake'

export function storeKeepsake(keepsake: Keepsake): void {
  if (!import.meta.client) return
  const write = (k: Keepsake) =>
    window.localStorage.setItem(KEEPSAKE_KEY, JSON.stringify({ ...k, saved_at: Date.now() }))
  try {
    write(keepsake)
  } catch {
    // Stockage plein : sans l'aube, le carnet tient encore.
    try { write({ ...keepsake, image: undefined }) } catch { /* rien à garder */ }
  }
}

export function forgetKeepsake(): void {
  if (!import.meta.client) return
  try { window.localStorage.removeItem(KEEPSAKE_KEY) } catch { /* sans conséquence */ }
}

export function readKeepsake(days: number): Keepsake | null {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(KEEPSAKE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Keepsake & { saved_at?: number }
    if (!stored.saved_at || Date.now() - stored.saved_at > days * 86_400_000) {
      window.localStorage.removeItem(KEEPSAKE_KEY)
      return null
    }
    return stored
  } catch {
    return null
  }
}
