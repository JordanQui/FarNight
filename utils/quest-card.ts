/**
 * La carte du but de la nuit, à partager : l'auberge en haut, la phrase
 * dessous, au format story (1080×1920).
 *
 * Dessinée dans le navigateur, sans appel au modèle : l'image est celle, figée,
 * de l'auberge, et la phrase est `night.goal`, que le barman a déjà dite —
 * rien de l'aventure ne sort. Les couleurs sont lues sur `<html>`, où la
 * palette de la scène les a posées.
 */

const W = 1080
const H = 1920
/** Le haut et le bas d'une story sont couverts par l'application : rien d'écrit n'y descend. */
const IMAGE_H = 1100
const TEXT_W = 880
const TEXT_BOTTOM = 1500
const QUOTE_MAX_H = 620

const DISPLAY = 'Futura, "Avenir Next", "Century Gothic", "Trebuchet MS", system-ui, sans-serif'
const SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif'

export interface QuestCard {
  goal: string
  /** « Le but de la nuit ». */
  label: string
  /** Le titre du jeu dans la langue du joueur. */
  title: string
  host: string
  /** Balise BCP 47 : coupe les lignes et met les capitales. */
  tag: string
  dir: 'ltr' | 'rtl'
}

/** Une couleur de l'interface : `--neon-500` → `rgb(255 46 136 / a)`. */
function color(name: string, alpha = 1): string {
  return `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim()} / ${alpha})`
}

/**
 * Coupe la phrase en lignes, mot à mot — signe à signe en chinois et en
 * japonais, où il n'y a pas d'espaces. Une ponctuation ne commence jamais
 * une ligne.
 */
function wrap(ctx: CanvasRenderingContext2D, text: string, tag: string): string[] {
  let words: Array<{ segment: string; isWordLike?: boolean }>
  try {
    words = [...new Intl.Segmenter(tag, { granularity: 'word' }).segment(text)]
  } catch {
    words = text.split(/(\s+)/).map(segment => ({ segment, isWordLike: !!segment.trim() }))
  }
  const lines: string[] = []
  let line = ''
  for (const { segment, isWordLike } of words) {
    if (isWordLike && line.trim() && ctx.measureText(line + segment).width > TEXT_W) {
      lines.push(line.trim())
      line = segment
    } else {
      line += segment
    }
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}

export async function drawQuestCard(card: QuestCard): Promise<Blob> {
  const image = new Image()
  image.src = '/scenes/auberge.png'
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.direction = card.dir
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  // L'arabe se lie : l'interlettrage y casse les mots.
  const spaced = (px: number) => { ctx.letterSpacing = card.dir === 'rtl' ? '0px' : `${px}px` }

  ctx.fillStyle = color('--ink-900')
  ctx.fillRect(0, 0, W, H)

  // L'auberge, recadrée au centre : le comptoir, la foule, la ville par la baie.
  const sw = W * image.height / IMAGE_H
  ctx.drawImage(image, (image.width - sw) / 2, 0, sw, image.height, 0, 0, W, IMAGE_H)

  // Le voile de l'affiche : sombre en haut, fondu dans la nuit en bas.
  const veil = ctx.createLinearGradient(0, 0, 0, IMAGE_H)
  veil.addColorStop(0, color('--ink-900', 0.7))
  veil.addColorStop(0.2, color('--ink-900', 0))
  veil.addColorStop(0.5, color('--ink-900', 0.15))
  veil.addColorStop(1, color('--ink-900'))
  ctx.fillStyle = veil
  ctx.fillRect(0, 0, W, IMAGE_H)

  // La même averse que l'accueil, dérivée de l'index.
  for (let i = 0; i < 36; i++) {
    const x = ((i * 37) % 100) / 100 * W
    const y = ((i * 53) % 100) / 100 * IMAGE_H * 0.7
    const h = 60 + (i * 11) % 140
    const drop = ctx.createLinearGradient(0, y, 0, y + h)
    drop.addColorStop(0, 'rgb(181 188 203 / 0)')
    drop.addColorStop(1, `rgb(181 188 203 / ${0.2 + ((i * 5) % 5) / 12})`)
    ctx.fillStyle = drop
    ctx.fillRect(x, y, 2, h)
  }

  // La phrase, la plus grande qui tienne, posée juste au-dessus du pied.
  let size = 66
  let lines: string[]
  for (;;) {
    ctx.font = `italic ${size}px ${SERIF}`
    lines = wrap(ctx, card.goal, card.tag)
    if (lines.length * size * 1.28 <= QUOTE_MAX_H || size <= 36) break
    size -= 2
  }
  const lead = size * 1.28
  const top = TEXT_BOTTOM - lines.length * lead

  ctx.shadowColor = 'rgb(0 0 0 / 0.7)'
  ctx.shadowBlur = 12
  ctx.fillStyle = color('--ink-50')
  lines.forEach((line, i) => ctx.fillText(line, W / 2, top + i * lead))

  // Le libellé, en néon.
  ctx.font = `500 30px ${DISPLAY}`
  spaced(12)
  ctx.shadowColor = color('--neon-500', 0.9)
  ctx.shadowBlur = 18
  ctx.fillStyle = color('--neon-300')
  ctx.fillText(card.label.toLocaleUpperCase(card.tag), W / 2, top - 84)

  // Le pied : un filet, le titre du jeu, son adresse.
  ctx.shadowBlur = 0
  ctx.fillStyle = color('--neon-500', 0.7)
  ctx.fillRect(W / 2 - 60, 1576, 120, 2)
  ctx.font = `500 34px ${DISPLAY}`
  spaced(10)
  ctx.fillStyle = color('--ink-50')
  ctx.fillText(card.title.toLocaleUpperCase(card.tag), W / 2, 1612)
  ctx.font = `400 26px ${DISPLAY}`
  spaced(6)
  ctx.fillStyle = color('--ink-50', 0.6)
  ctx.fillText(card.host, W / 2, 1668)

  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('quest card')),
    'image/jpeg',
    0.92,
  ))
}
