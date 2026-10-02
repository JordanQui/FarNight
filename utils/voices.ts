import { MODES, modeFor, rootMidiFor, midiToNote, type Mode } from '~/utils/modes'
import { subjectFor, fugueLine } from '~/utils/fugue'
import { namankOf } from '~/utils/numerology'

/**
 * La voix d'un personnage : sa famille de synthèse.
 *
 * Le mode donne les hauteurs, la voix donne la matière. Deux personnages
 * peuvent partager un mode et sonner très différemment — c'est ce qui rend
 * chacun reconnaissable au premier pas de l'arpège.
 */

export type VoiceKey = 'drumbass' | 'sinus' | 'drone' | 'acid' | 'stabs'

export interface Voice {
  key: VoiceKey
  /** Ce que la matière raconte du personnage. */
  intention: string
  /**
   * Registre cible, en numéro MIDI.
   *
   * Un décalage d'octave fixe ne suffisait pas : le renversement du sujet
   * descend loin sous la tonique, et le drone tombait à 17 Hz — inaudible,
   * surtout sur un haut-parleur de téléphone. La ligne est donc recentrée
   * autour de cette hauteur, quel que soit son contour.
   */
  center: number
  /** Densité rythmique : 1 = une note par double-croche. */
  density: 1 | 2 | 4
}

export const VOICES: Record<VoiceKey, Voice> = {
  drumbass: {
    key: 'drumbass',
    center: 43,
    intention: 'lourd, buté, ce qui cogne et ne cède pas',
    density: 2,
  },
  sinus: {
    key: 'sinus',
    center: 64,
    intention: 'fragile, flottant, un signal qui se dégrade',
    density: 1,
  },
  drone: {
    key: 'drone',
    center: 52,
    intention: 'tenu, immobile, ce qui dure et pèse',
    density: 4,
  },
  acid: {
    key: 'acid',
    center: 55,
    intention: 'nerveux, fuyant, ce qui se dérobe',
    density: 1,
  },
  stabs: {
    key: 'stabs',
    center: 67,
    intention: 'net, ponctuel, ce qui tranche et rend la main',
    density: 2,
  },
}

/**
 * Quelle voix pour quel mode.
 *
 * L'appariement suit la connotation : le mode dit l'affect, la voix lui donne
 * un corps. Sept modes pour cinq voix — certaines en servent deux, ce qui est
 * sans conséquence puisque les hauteurs, elles, restent distinctes.
 */
const BY_MODE: Record<string, VoiceKey> = {
  ionien: 'stabs',       // clarté, ce qui est à sa place — le barman
  mixolydien: 'stabs',   // la rue qui parle
  dorien: 'drone',       // noblesse mélancolique — celui qui garde
  eolien: 'drone',       // deuil, ce qui pèse
  phrygien: 'acid',      // menace sourde — celui qui nie
  lydien: 'sinus',       // rêve, ce qui flotte
  locrien: 'drumbass',   // vertige, ce qui a rompu
}

export function voiceFor(mode: Mode): Voice {
  return VOICES[BY_MODE[mode.name] ?? 'sinus']
}

/**
 * Le motif joué, selon la densité de la voix.
 *
 * Toujours un flux continu de doubles-croches : ce sont les répétitions qui
 * changent, pas les silences. Un drone tient chaque degré quatre pas, une
 * basse deux, un sinus un seul.
 */
/**
 * Bornes du domaine joué.
 *
 * En dessous de Mi1 (82 Hz), un haut-parleur de téléphone ne restitue rien —
 * le personnage paraît muet alors qu'il joue. Au-dessus de Mi6, le sinus
 * devient une aiguille désagréable.
 */
const FLOOR_MIDI = 40
const CEIL_MIDI = 88

/**
 * Un nombre de 1 à 9 tiré des caractères eux-mêmes, quand le nom n'a aucune
 * lecture numérologique — un nom chinois inventé par le modèle. Ce n'est pas
 * une tradition, c'est une empreinte stable : sans elle, tous les personnages
 * d'une partie en chinois prenaient le premier sujet et chantaient la même
 * ligne.
 */
function glyphNumber(name: string): number {
  const sum = [...name].reduce((n, ch) => n + (ch.codePointAt(0) ?? 0), 0)
  return (sum % 9) + 1
}

export function buildPattern(name: string, mode: Mode, voice: Voice): string[] {
  // Le nombre du nom choisit le sujet : c'est la correspondance symbolique
  // entre le personnage et sa figure. Faute de nom lisible, on prend le
  // premier sujet plutôt que de rester muet.
  const subject = subjectFor(namankOf(name) ?? glyphNumber(name))
  const raw = fugueLine(mode, subject, rootMidiFor(name))

  // Recentrage : on translate la ligne entière par octaves jusqu'à ce que sa
  // moyenne rejoigne le registre de la voix. Sans ça, un sujet qui descend
  // sortait du domaine audible et le personnage paraissait muet.
  // Le registre visé combine la famille de voix et l'affect du mode : deux
  // personnages en drone ne se placent pas à la même hauteur si l'un tient et
  // l'autre s'effondre.
  const target = voice.center + mode.register
  const mean = raw.reduce((sum, n) => sum + n, 0) / raw.length
  let shifted = raw.map(n => n + Math.round((target - mean) / 12) * 12 + mode.register)

  // Puis on borne. Centrer sur la moyenne ne dit rien de la note la plus
  // grave : le renversement d'un sujet large descend de trois octaves, et le
  // drone se retrouvait à 19 Hz — parfaitement silencieux sur un téléphone.
  // Le recadrage se fait par octaves entières, la ligne reste dans son mode.
  const min = Math.min(...shifted)
  if (min < FLOOR_MIDI) {
    const up = Math.ceil((FLOOR_MIDI - min) / 12) * 12
    shifted = shifted.map(n => n + up)
  }
  const max = Math.max(...shifted)
  if (max > CEIL_MIDI) {
    const down = Math.ceil((max - CEIL_MIDI) / 12) * 12
    shifted = shifted.map(n => n - down)
  }

  const line = shifted.map(midiToNote)

  // La densité répète chaque degré : un drone tient, une basse appuie, un
  // sinus passe. Le sujet reste le même, sa lecture change.
  return line.flatMap(note => Array.from({ length: voice.density }, () => note))
}

/**
 * Attribue une voix DISTINCTE à chaque personnage d'une scène.
 *
 * L'appariement par mots-clés laisse forcément des personnages sans
 * correspondance, et le repli par empreinte les fait alors collisionner : sur
 * une scène de quatre habitués, trois pouvaient se retrouver avec le même
 * drone. Or c'est justement la différence entre les voix qui rend chacun
 * reconnaissable — sans elle, la mécanique ne dit plus rien.
 *
 * On garde donc le choix sémantique quand il existe, et on décale seulement
 * ceux qui entrent en conflit. Cinq voix pour au plus cinq personnages : la
 * distinction est toujours atteignable.
 */
export function assignVoices(
  npcs: Array<{ name: string; posture?: string }>
): Map<string, { mode: Mode; voice: Voice }> {
  const order = Object.keys(MODES)
  const taken = new Set<VoiceKey>()
  const result = new Map<string, { mode: Mode; voice: Voice }>()

  for (const npc of npcs) {
    const preferred = modeFor(npc.posture, npc.name)

    // On part du mode voulu et on avance dans la table jusqu'à trouver une
    // voix libre. L'ordre est fixe, donc le résultat reste reproductible.
    let mode = preferred
    let steps = 0
    while (taken.has(voiceFor(mode).key) && steps < order.length) {
      steps++
      const next = order[(order.indexOf(preferred.name) + steps) % order.length]
      mode = MODES[next]
    }

    const voice = voiceFor(mode)
    taken.add(voice.key)
    result.set(npc.name, { mode, voice })
  }

  return result
}

/**
 * La voix d'un nom, avec repli.
 *
 * `assignVoices` n'indexe que les personnages présents dans la scène. Un nom
 * mis en avant dans le récit mais absent de cette liste — casse différente,
 * personnage disparu d'une régénération — restait alors totalement muet, sans
 * la moindre trace. Ici, il obtient au moins une voix cohérente.
 */
export function voiceOfName(
  name: string,
  npcs: Array<{ name: string; posture?: string }>
): { mode: Mode; voice: Voice } {
  const assigned = assignVoices(npcs).get(name)
  if (assigned) return assigned

  const mode = modeFor(undefined, name)
  return { mode, voice: voiceFor(mode) }
}
