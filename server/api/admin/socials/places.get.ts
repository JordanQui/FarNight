/**
 * Les lieux pour un mot (`?q=`), pour viser ou exclure dans un groupe de
 * cibles de /nimda/socials : ceux de Meta, avec `?pin=1` les adresses
 * d'OpenStreetMap où poser un point, avec `?x=1` ceux de X pour une
 * promotion X. Lecture seule ; voir server/socials/ads.ts et x-ads.ts.
 */
import { addresses, places } from '../../../socials/ads'
import { bad } from '../../../socials/common'
import { xPlaces } from '../../../socials/x-ads'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const q = String(query.q ?? '').trim()
  if (q.length < 2 || q.length > 120) throw bad('lieux : de 2 à 120 signes')
  return query.x ? xPlaces(q) : query.pin ? addresses(q) : places(q)
})
