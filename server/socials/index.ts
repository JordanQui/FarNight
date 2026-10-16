/** Les réseaux de /nimda/socials, dans l'ordre des onglets. Voir common.ts. */
import type { Network } from './common'
import { facebook, instagram } from './meta'
import { tiktok } from './tiktok'
import { x } from './x'
import { youtube } from './youtube'

export const NETWORKS: Network[] = [instagram, facebook, tiktok, youtube, x]

export function network(id: unknown) {
  const n = NETWORKS.find(n => n.id === id)
  if (!n) throw createError({ statusCode: 404, statusMessage: `réseau inconnu : ${String(id)}` })
  return n
}
