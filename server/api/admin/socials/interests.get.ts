/**
 * Les intérêts Meta pour un mot (`?q=`), pour composer un groupe de cibles
 * dans /nimda/socials. Lecture seule ; voir server/socials/ads.ts.
 */
import { interests } from '../../../socials/ads'
import { bad } from '../../../socials/common'

export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (q.length < 2 || q.length > 60) throw bad('intérêts : de 2 à 60 signes')
  return interests(q)
})
