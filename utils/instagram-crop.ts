/**
 * Les trois formats d'Instagram, et comment une image source y entre.
 *
 * Une seule image source (2:3, ce que rend gpt-image en portrait) donne les
 * trois déclinaisons. Le calcul est pur : la page l'utilise pour l'aperçu
 * comme pour l'export, et les deux ne peuvent donc pas diverger.
 */

export type FormatId = '1x1' | '4x5' | '9x16'

export interface Format {
  id: FormatId
  label: string
  /** Taille d'export, en pixels : celle qu'Instagram affiche sans recompresser. */
  width: number
  height: number
}

export const FORMATS: readonly Format[] = [
  { id: '1x1', label: 'Post carré', width: 1080, height: 1080 },
  { id: '4x5', label: 'Post portrait', width: 1080, height: 1350 },
  { id: '9x16', label: 'Story / Reel', width: 1080, height: 1920 },
]

/**
 * `crop` remplit le cadre et coupe ce qui dépasse ; `fit` montre l'image
 * entière et comble le reste avec la couleur de fond — ce que les premières
 * stories faisaient à la main, en bandes noires.
 */
export interface Framing {
  mode: 'crop' | 'fit'
  /** Point visé, de 0 (gauche / haut) à 1 (droite / bas). */
  x: number
  y: number
  /** 1 = le plus grand cadrage possible ; au-delà, on resserre. */
  zoom: number
}

export const DEFAULT_FRAMING: Framing = { mode: 'crop', x: 0.5, y: 0.5, zoom: 1 }

export interface Rect { x: number; y: number; w: number; h: number }

/** Où poser la source dans le cadre de sortie. */
export interface Placement {
  /** La partie de la source à prendre. */
  src: Rect
  /** Où la dessiner dans la sortie. */
  dst: Rect
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function place(
  srcW: number, srcH: number, outW: number, outH: number, framing: Framing,
): Placement {
  const zoom = clamp(framing.zoom || 1, 1, 4)
  const fx = clamp(framing.x, 0, 1)
  const fy = clamp(framing.y, 0, 1)

  if (framing.mode === 'fit') {
    // L'image entière tient dans le cadre ; le zoom l'agrandit, sans jamais
    // la faire déborder — au-delà, c'est un recadrage, et `crop` est là pour ça.
    const contain = Math.min(outW / srcW, outH / srcH)
    const cover = Math.max(outW / srcW, outH / srcH)
    const scale = Math.min(contain * zoom, cover)
    const w = srcW * scale
    const h = srcH * scale
    return {
      src: { x: 0, y: 0, w: srcW, h: srcH },
      dst: { x: (outW - w) * fx, y: (outH - h) * fy, w, h },
    }
  }

  // Le plus grand rectangle de la proportion voulue qui tienne dans la source,
  // resserré par le zoom, puis glissé vers le point visé sans sortir du bord.
  const ratio = outW / outH
  let w = srcW
  let h = srcW / ratio
  if (h > srcH) {
    h = srcH
    w = srcH * ratio
  }
  w /= zoom
  h /= zoom
  return {
    src: { x: (srcW - w) * fx, y: (srcH - h) * fy, w, h },
    dst: { x: 0, y: 0, w: outW, h: outH },
  }
}
