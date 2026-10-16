/**
 * Ce que la page /nimda/socials dessine : les réseaux, leurs formats, ce
 * qu'il faut pour les brancher, et le journal des publications. Aucun appel
 * aux réseaux ici ; l'état réel se lit dans scan.ts.
 */
import { NETWORKS } from '../../../socials'
import { journal } from '../../../socials/common'

export default defineEventHandler(async (event) => {
  const port = getRequestURL(event).port || '3000'
  return {
    networks: await Promise.all(NETWORKS.map(async n => ({
      id: n.id,
      label: n.label,
      formats: n.formats,
      setup: n.setup(port),
      ready: n.ready(),
      connected: n.ready() && await n.connected(),
    }))),
    journal: await journal(),
  }
})
