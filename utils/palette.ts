import type { ScenePalette } from '~/types/scene'
import type { UserProfile } from '~/types/user'

/**
 * Garde-fou colorimétrique, calé sur la direction artistique Dark Deco
 * (série animée Batman des années 90) : une nuit profonde percée par une
 * seule lumière.
 *
 * Demander « 10 % d'accent » dans un prompt ne suffit pas. Si le modèle choisit
 * trois couleurs de luminosité voisine, ou un accent désaturé, la répartition
 * existe dans l'image mais ne se lit pas. On impose donc ici une hiérarchie
 * stricte — ombre / ton moyen / lumière — de façon déterministe, sans appel API.
 */

type Rgb = { r: number; g: number; b: number }
type Hsl = { h: number; s: number; l: number }

/** Dominante : l'ombre. Très sombre et sourde, proche d'un noir teinté. */
const DOMINANT_L = { min: 0.08, max: 0.24 }
const DOMINANT_MAX_SATURATION = 0.45

/** Secondaire : l'architecture en lumière indirecte. Ton moyen. */
const SECONDARY_L = { min: 0.34, max: 0.54 }
const SECONDARY_MAX_SATURATION = 0.6

/** Accent : la lumière. Vif, chromatique, jamais neutre. */
const ACCENT_L = { min: 0.52, max: 0.66 }
const ACCENT_MIN_SATURATION = 0.85

/** En dessous, la teinte d'origine est grise : elle ne porte aucun sens. */
const NEUTRAL_SATURATION = 0.18

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let tn = t
    if (tn < 0) tn += 1
    if (tn > 1) tn -= 1
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 }
}

/** Luminance relative WCAG. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a))
  const lb = relativeLuminance(hexToRgb(b))
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Distance de teinte sur la roue, de 0 (identique) à 0,5 (opposée). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1
  return Math.min(d, 1 - d)
}

/** Une graine textuelle stable, indépendante du moteur JavaScript. */
function hashText(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // Avalanche finale : `a1s1` et `a1s2` ne doivent pas devenir deux teintes
  // presque identiques sous prétexte que seul leur dernier caractère change.
  hash += hash << 13
  hash ^= hash >>> 7
  hash += hash << 3
  hash ^= hash >>> 17
  hash += hash << 5
  return hash >>> 0
}

/**
 * Deux saisies équivalentes doivent donner la même couleur : casse, accents et
 * espaces de présentation ne font pas partie de la réponse elle-même.
 */
function colorSeed(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join('|')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const NAMED_HUES: Array<[RegExp, number]> = [
  [/\b(rouge|red|scarlet|vermeil|crimson)\b/u, 0],
  [/\b(orange|ambre|amber|coucher de soleil|sunset)\b/u, 0.08],
  [/\b(jaune|yellow|dore|gold)\b/u, 0.15],
  [/\b(vert|green|emeraude|emerald)\b/u, 0.35],
  [/\b(turquoise|cyan)\b/u, 0.48],
  [/\b(bleu|bleue|blue|azur|azure)\b/u, 0.59],
  [/\b(violet|purple|mauve|lilas|lilac)\b/u, 0.76],
  [/\b(rose|pink|magenta|fuchsia)\b/u, 0.9],
]

/** An explicitly named colour takes precedence over any scene-specific offset. */
function namedHue(source: string): number | undefined {
  return NAMED_HUES.find(([pattern]) => pattern.test(source))?.[1]
}

const turn = (h: number) => ((h % 1) + 1) % 1
const seededHue = (source: string, role: string, sceneId: string) =>
  hashText(`${role}|${source}|${sceneId}`) / 4294967296

/**
 * Les six lieux jouables occupent six secteurs régulièrement espacés.
 * Cela évite deux cartes appelées toutes deux « Ambre », cas qui rendrait un
 * lecteur incapable de dire laquelle il attend. Un id hors plan garde un
 * décalage hashé, utile aux scènes de développement.
 */
function sceneHueOffset(sceneId: string): number {
  const match = /^a(\d+)s(\d+)$/.exec(sceneId)
  if (!match) return hashText(sceneId) / 4294967296
  const act = Number(match[1])
  const slot = Number(match[2])
  const index = Math.max(0, (act - 1) * 2 + slot - 1)
  return (index % 6) / 6
}

export interface DeterministicPaletteHexes {
  dominant: string
  secondary: string
  accent: string
}

/**
 * Les trois couleurs calculées depuis le formulaire, sans modèle génératif.
 *
 * Une couleur explicitement nommée garde sa teinte entre les lieux. Sans nom
 * de couleur, le lieu entre dans la graine : ses régénérations sont identiques
 * et ses cartes restent distinctes. Les sources suivent `script.json`.
 */
export function deterministicPaletteHexes(
  user: UserProfile,
  sceneId: string,
): DeterministicPaletteHexes {
  const identity = colorSeed([
    user.identity.name,
    user.identity.birthday,
  ]) || 'far-night'
  const dominantSource = colorSeed([
    user.origin.hometown?.name,
    user.origin.current_location?.name,
  ]) || identity
  const secondarySource = colorSeed([
    user.imprints?.refuge,
    user.imprints?.keepsake,
  ]) || identity
  // Le moment est la source ; l'animal n'est que son repli quand il manque.
  // Les concaténer ferait changer la lumière d'un moment pourtant identique.
  const accentSource = colorSeed([
    user.touchstones?.moment || user.touchstones?.animal,
  ]) || identity

  let dominantHue = namedHue(dominantSource) ?? seededHue(dominantSource, 'dominant', sceneId)
  let secondaryHue = namedHue(secondarySource) ?? seededHue(secondarySource, 'secondary', sceneId)
  // Une couleur explicitement nommée a un seul sens, quel que soit le lieu.
  // Sans indice de couleur, le secteur du lieu différencie les cartes.
  const accentHue = namedHue(accentSource)
    ?? turn(seededHue(accentSource, 'accent', 'player') + sceneHueOffset(sceneId))

  // Une palette hashée peut tomber par hasard trois fois dans la même famille.
  // L'accent reste intact : ce sont les deux teintes de fond que l'on décale.
  while (hueDistance(dominantHue, accentHue) < 0.18) {
    dominantHue = turn(dominantHue + 0.38196601125)
  }
  while (
    hueDistance(secondaryHue, dominantHue) < 0.12
    || hueDistance(secondaryHue, accentHue) < 0.18
  ) {
    secondaryHue = turn(secondaryHue + 0.2360679775)
  }

  return {
    dominant: rgbToHex(hslToRgb({ h: dominantHue, s: 0.36, l: 0.16 })),
    secondary: rgbToHex(hslToRgb({ h: secondaryHue, s: 0.55, l: 0.44 })),
    accent: rgbToHex(hslToRgb({ h: accentHue, s: 0.95, l: 0.59 })),
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** Ramène une couleur dans une bande de luminosité et de saturation, teinte conservée. */
function fit(hex: string, band: { min: number; max: number }, satMin: number, satMax: number): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex))
  return rgbToHex(hslToRgb({
    h,
    s: clamp(s, satMin, satMax),
    l: clamp(l, band.min, band.max),
  }))
}

/**
 * Teinte de l'accent. Conservée quand elle porte du sens — elle vient de la
 * lumière du moment auquel le joueur tient. Remplacée seulement si la couleur d'origine est grise,
 * auquel cas on prend la teinte la plus éloignée des deux autres.
 */
function accentHue(original: string, dominant: string, secondary: string): number {
  const { h, s } = rgbToHsl(hexToRgb(original))
  if (s >= NEUTRAL_SATURATION) return h

  const hDom = rgbToHsl(hexToRgb(dominant)).h
  const hSec = rgbToHsl(hexToRgb(secondary)).h
  let best = 0
  let bestGap = -1
  for (let i = 0; i < 24; i++) {
    const candidate = i / 24
    const gap = Math.min(hueDistance(candidate, hDom), hueDistance(candidate, hSec))
    if (gap > bestGap) { bestGap = gap; best = candidate }
  }
  return best
}

export interface PaletteAudit {
  palette: ScenePalette
  adjusted: boolean
  original_dominant: string
  original_secondary: string
  original_accent: string
  contrast_vs_dominant: number
  contrast_vs_secondary: number
  base_contrast: number
}

/**
 * Impose la hiérarchie Dark Deco : ombre, ton moyen, lumière.
 * Les teintes du modèle sont préservées — ce sont elles qui portent le lien au
 * joueur — seules luminosité et saturation sont recalées.
 */
export function enforceAccentVisibility(palette: ScenePalette): PaletteAudit {
  const originalDominant = palette.dominant.hex
  const originalSecondary = palette.secondary.hex
  const originalAccent = palette.accent.hex

  const dominant = fit(originalDominant, DOMINANT_L, 0, DOMINANT_MAX_SATURATION)
  const secondary = fit(originalSecondary, SECONDARY_L, 0, SECONDARY_MAX_SATURATION)

  const h = accentHue(originalAccent, dominant, secondary)
  const { s, l } = rgbToHsl(hexToRgb(originalAccent))
  const accent = rgbToHex(hslToRgb({
    h,
    s: clamp(s, ACCENT_MIN_SATURATION, 1),
    l: clamp(l, ACCENT_L.min, ACCENT_L.max),
  }))

  return {
    palette: {
      dominant: { ...palette.dominant, hex: dominant },
      secondary: { ...palette.secondary, hex: secondary },
      accent: { ...palette.accent, hex: accent },
    },
    adjusted:
      dominant !== originalDominant ||
      secondary !== originalSecondary ||
      accent !== originalAccent,
    original_dominant: originalDominant,
    original_secondary: originalSecondary,
    original_accent: originalAccent,
    contrast_vs_dominant: contrastRatio(accent, dominant),
    contrast_vs_secondary: contrastRatio(accent, secondary),
    base_contrast: contrastRatio(dominant, secondary),
  }
}
