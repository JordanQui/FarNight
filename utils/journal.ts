import type { NightPlan, PlannedScene, SceneTextResponse } from '~/types/scene'

/**
 * Ce qu'une scène laisse à la suivante.
 *
 * L'histoire n'est pas générée d'un bloc au départ : toute la nuit demanderait
 * 26 000 tokens de sortie pour un plafond de 16 384, et ça figerait tout avant
 * que le joueur ait joué. Chaque scène naît donc à son tour, avec ce résumé.
 *
 * Il est construit à partir de ce que le client a DÉJÀ — titre, lieu, objectif,
 * noms, objet emporté. Aucun appel au modèle pour résumer : ça ne coûte rien à
 * fabriquer, et environ 0,06 centime d'entrée par scène à transporter.
 */
export interface JournalEntry {
  scene_title: string
  place_name: string
  /** Ce que le joueur y a accompli : l'objectif de la scène. */
  what_changed: string
  /** Les noms qui ont compté, pour qu'ils ne réapparaissent pas ailleurs. */
  who_mattered: string[]
  /** Ce qu'il en a emporté. */
  carried: string | null
  /**
   * La chose qui dominait le lieu, telle que le joueur l'a lue.
   *
   * C'est par elle que le jeu se souvient d'un lieu, plus tard — le lecteur de
   * carte ne dit pas « la carte de tel endroit », il décrit ce qu'on y a vu.
   * N'entre pas dans le prompt : zéro token. Absente des journaux d'avant ce
   * champ, et l'indice retombe alors sur le nom du lieu.
   */
  focal?: string
  /**
   * La quête de la nuit, fixée à l'auberge : le but et le plan sur lesquels
   * toutes les scènes se construisent. Optionnelle, les journaux d'avant ce
   * champ n'en ont pas.
   */
  night?: NightPlan
}

export function entryFrom(scene: SceneTextResponse): JournalEntry {
  const byId = (id?: string) => scene.npcs?.find(n => n.id === id)?.name
  const who = [byId(scene.key_item?.informant_npc_id), byId(scene.key_item?.npc_id)]
    .filter((n): n is string => Boolean(n))

  return {
    scene_title: scene.scene_title,
    place_name: scene.place?.name ?? scene.scene_title,
    what_changed: scene.quest?.objective ?? '',
    who_mattered: who,
    carried: scene.key_item?.name ?? null,
    focal: scene.decor?.find(d => d.slot_id === 'focal')?.name?.slice(0, 80) || undefined,
    // Le titre et l'horizon sont figés avec le plan : les scènes suivantes les
    // recopient au lieu d'en inventer, et le sas les promet tels quels.
    night: scene.night
      ? {
          ...scene.night,
          title: scene.night.title || scene.quest?.title,
          horizon: scene.night.horizon || scene.quest?.artifact,
        }
      : undefined,
  }
}

/** La quête de la nuit, telle que l'auberge l'a fixée. Cherchée sur tout le journal. */
export function nightOf(entries: JournalEntry[]): NightPlan | undefined {
  return entries.find(e => e.night?.goal)?.night
}

/** Un lieu du plan, par l'identifiant de sa scène. */
export function plannedScene(plan: NightPlan | undefined, sceneId?: string): PlannedScene | undefined {
  if (!plan || !sceneId) return undefined
  return plan.acts?.flatMap(a => a.scenes ?? []).find(s => s.scene_id === sceneId)
}

/**
 * Un lieu du plan renvoyé par le client, borné.
 *
 * Il entre dans le prompt image et dans celui des tours : comme tout ce qui
 * vient du navigateur, il ne doit pas pouvoir y faire passer un roman.
 */
export function clampPlanned(p?: PlannedScene | null): PlannedScene | null {
  if (!p || typeof p !== 'object') return null
  const cut = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '')
  return {
    scene_id: cut(p.scene_id, 40),
    title: cut(p.title, 80),
    place: cut(p.place),
    focal: cut(p.focal),
    step: cut(p.step),
    requirement: cut(p.requirement),
    exit_label: cut(p.exit_label, 80),
  }
}

/** Le résumé tel que le modèle le lit. Borné : les scènes anciennes tombent. */
export function renderJournal(entries: JournalEntry[], max: number): string {
  // Le but se lit AVANT de borner : l'auberge sort du résumé à la septième
  // scène, et le but de la nuit ne doit pas tomber avec elle.
  const goal = nightOf(entries)?.goal
  const body = entries.slice(-max).map((e, i) => {
    const lines = [`${i + 1}. ${e.scene_title} — ${e.place_name}`]
    if (e.what_changed) lines.push(`   ce qui s'y est joué : ${e.what_changed}`)
    if (e.who_mattered.length) lines.push(`   qui a compté : ${e.who_mattered.join(', ')}`)
    if (e.carried) lines.push(`   emporté : ${e.carried}`)
    return lines.join('\n')
  }).join('\n')
  return goal ? `Ce qu'il est sorti chercher cette nuit : ${goal}\n${body}` : body
}

/**
 * Un objet que le joueur transporte d'une scène à l'autre.
 *
 * `decrypted` dit si son nom a été lu — un objet dont l'épreuve n'a pas été
 * passée ne peut pas être nommé dans le récit, puisque le joueur l'ignore.
 */
export interface CarriedItem {
  id: string
  label: string
  decrypted: boolean
  /** Le lieu où il a été ramassé, pour que le récit puisse y renvoyer. */
  from?: string
  /**
   * `key` : il ouvre quelque chose, ici ou plus loin. `lore` : il n'ouvre rien
   * et éclaire la quête. `trade` : quelqu'un d'autre le veut, et c'est le seul
   * qu'un personnage puisse réclamer — prendre au joueur ce qui ouvre le
   * laisserait devant une porte qu'il ne peut plus franchir.
   */
  kind: 'key' | 'lore' | 'trade'
  /** Sa couleur, pour une carte : c'est ce que le joueur retient et compare. */
  color?: string
  /** Cette couleur en #RRGGBB : la seconde moitié d'une carte reprend celle de la première. */
  hex?: string
}
