import type { FormatId, Framing } from '~/utils/instagram-crop'

/** Où en est un post, de l'idée à la mise en ligne. */
export type PostStatus = 'idee' | 'brouillon' | 'pret' | 'publie'

export interface InstagramPost {
  id: string
  title: string
  /**
   * Le sujet de l'image, en anglais : ce que gpt-image doit peindre. Le style
   * Dark Deco et la palette sont ajoutés côté serveur, jamais recopiés ici.
   */
  subject: string
  notes: string
  status: PostStatus
  /** AAAA-MM-JJ. */
  scheduled_for: string | null
  published_at: string | null
  caption: string
  hashtags: string[]
  /** Texte alternatif, à coller dans les paramètres avancés d'Instagram. */
  alt: string
  /** Toutes les images sources essayées, chemins relatifs à `communication/`. */
  sources: string[]
  /** Celle qui sert aux déclinaisons. */
  source: string | null
  framing: Record<FormatId, Framing>
  /** Les fichiers exportés, chemins relatifs à `communication/`. */
  renders: Partial<Record<FormatId, string>>
  created_at: string
  updated_at: string
}

/** Une proposition de post, rendue par Claude. */
export interface PostIdea {
  title: string
  subject: string
  angle: string
}
