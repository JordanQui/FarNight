import type { FormatId, Framing } from '~/utils/instagram-crop'

/** Où en est un post, de l'idée à la mise en ligne. */
export type PostStatus = 'idee' | 'brouillon' | 'pret' | 'publie'

/** Ce qu'on publie : chaque post est l'un des trois, jamais tous à la fois. */
export type PostKind = 'publication' | 'story' | 'reel'

export interface InstagramPost {
  id: string
  title: string
  kind: PostKind
  /**
   * Le seul format exporté : carré ou 4:5 pour une publication, 9:16 pour
   * une story ou un Reel (voir formatsFor).
   */
  format: FormatId
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
  /** Le texte incrusté sur une story, à la place de la légende qu'elle n'a pas. */
  overlay: StoryOverlay
  /** Toutes les images sources essayées, chemins relatifs à `communication/`. */
  sources: string[]
  /** Celle qui sert aux déclinaisons. */
  source: string | null
  framing: Record<FormatId, Framing>
  /** Les fichiers exportés, chemins relatifs à `communication/`. */
  renders: Partial<Record<FormatId, string>>
  /**
   * Ce qui bouge quand Veo anime l'image, en anglais. Vide : le post reste
   * une image fixe.
   */
  motion: string
  /** Toutes les vidéos essayées, chemins relatifs à `communication/`. */
  videos: string[]
  /** Celle qui part en Reel. */
  video: string | null
  /**
   * Le pool d'un Reel : des images nommées que « Ce qui bouge » cite par
   * `@nom`. Veo ne les voit pas — Claude les regarde et les décrit dans le
   * prompt.
   */
  refs: ReelRef[]
  created_at: string
  updated_at: string
}

/**
 * L'accroche d'une story : dessinée sur le 9:16 à l'export, hors des zones
 * que l'interface d'Instagram recouvre en haut et en bas.
 */
export interface StoryOverlay {
  hook: string
  /** L'appel qui renvoie au sticker lien, ajouté à la main dans l'app. */
  cta: string
  position: 'top' | 'center' | 'bottom'
}

/** Une image de précision du Reel, citée par son nom dans « Ce qui bouge ». */
export interface ReelRef {
  /** Minuscules, chiffres et tirets : ce qui suit le @. */
  name: string
  /** Chemin relatif à `communication/`. */
  path: string
  /** Ce qu'on a demandé de peindre ; vide pour une image importée. */
  subject: string
}
