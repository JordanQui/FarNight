/**
 * Les derniers posts Instagram ou Facebook du compte et leurs pubs Meta, pour
 * /nimda/socials (`?network=instagram|facebook`). Lecture seule ; voir
 * server/socials/ads.ts.
 */
import { board } from '../../../socials/ads'
import { bad } from '../../../socials/common'

export default defineEventHandler((event) => {
  const network = getQuery(event).network
  if (network !== 'instagram' && network !== 'facebook') throw bad('pubs Meta : Instagram ou Facebook seulement')
  return board(network)
})
