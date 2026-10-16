/**
 * Publier un post depuis /nimda/socials. Formulaire multipart : `network`,
 * `format`, `text`, `title`, `options` (JSON), `urls` (une adresse publique
 * par ligne) et les fichiers sous `files`, dans l'ordre voulu.
 *
 * Le format du réseau (server/socials) dit ce qui est permis ; on le vérifie
 * ici avant tout envoi. Chaque essai, réussi ou non, va au journal.
 */
import type { Kind, Media } from '../../../socials/common'
import { network } from '../../../socials'
import { bad, failure, record } from '../../../socials/common'

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i
const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }

const kindOf = (type: string): Kind | null => type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'image' : null

/** Une adresse publique : l'extension dit s'il s'agit d'une vidéo. */
function fromUrl(raw: string): Media {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw bad(`adresse illisible : ${raw}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad(`adresse non web : ${raw}`)
  const ext = u.pathname.split('.').pop()?.toLowerCase() ?? ''
  const video = VIDEO_EXT.test(u.pathname)
  return { name: u.pathname.split('/').pop() || u.hostname, type: TYPES[ext] ?? (video ? 'video/mp4' : 'image/jpeg'), kind: video ? 'video' : 'image', url: u.href }
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts) throw bad('formulaire vide')
  const field = (name: string) => parts.find(p => p.name === name && !p.filename)?.data.toString('utf8') ?? ''

  const n = network(field('network'))
  const format = n.formats.find(f => f.id === field('format'))
  if (!format) throw bad(`${n.label} : format inconnu`)
  if (!n.ready() || !await n.connected()) throw bad(`${n.label} : pas encore branché (onglet Info)`)

  let options: Record<string, string | boolean>
  try {
    options = JSON.parse(field('options') || '{}')
  } catch {
    throw bad('options illisibles')
  }
  const files: Media[] = parts.filter(p => p.name === 'files' && p.filename).map((p) => {
    const kind = kindOf(p.type ?? '')
    if (!kind) throw bad(`${p.filename} : ni image ni vidéo`)
    return { name: p.filename!, type: p.type!, kind, data: p.data }
  })
  const urls = field('urls').split('\n').map(l => l.trim()).filter(Boolean).map(fromUrl)
  const media = [...files, ...urls]
  const text = field('text').trim()
  const title = field('title').trim()

  const label = `${n.label} ${format.label}`
  const rule = format.media
  if (!rule && media.length) throw bad(`${label} : pas de média dans ce format`)
  if (rule) {
    if (files.length && !rule.files) throw bad(`${label} : pas de fichier, seulement des adresses publiques`)
    if (urls.length && !rule.urls) throw bad(`${label} : pas d’adresse, seulement des fichiers`)
    if (media.length < rule.min || media.length > rule.max) {
      throw bad(`${label} : ${rule.min === rule.max ? rule.min : `de ${rule.min} à ${rule.max}`} média(s), ${media.length} reçu(s)`)
    }
    const odd = media.find(m => !rule.kinds.includes(m.kind))
    if (odd) throw bad(`${label} : ${odd.name} est une ${odd.kind === 'video' ? 'vidéo' : 'image'}, ce format n’en prend pas`)
  }
  if (format.text?.required && !text) throw bad(`${label} : ${format.text.label.toLowerCase()} manquant`)
  if (format.text && text.length > format.text.max) throw bad(`${label} : ${text.length} signes pour ${format.text.max} au plus`)
  if (format.title?.required && !title) throw bad(`${label} : titre manquant`)
  if (format.title && title.length > format.title.max) throw bad(`${label} : titre de ${title.length} signes pour ${format.title.max} au plus`)

  const excerpt = (title || text || media.map(m => m.name).join(', ')).replace(/\s+/g, ' ').slice(0, 90)
  try {
    const result = await n.publish({ format: format.id, text, title, media, options })
    return await record({ network: n.id, format: format.id, excerpt, ...result })
  } catch (e) {
    await record({ network: n.id, format: format.id, excerpt, ref: '', state: 'failed', detail: failure(e) })
    throw e
  }
})
