/**
 * Instagram et Facebook, par l'API Graph de Meta, avec un seul jeton : celui
 * de l'utilisateur système « monitor » du portfolio FarNight, `META_ADS_TOKEN`,
 * déjà lu par /nimda/monitor. Pour publier, il lui faut la page Facebook et le
 * compte Instagram attribués, et les permissions de publication en plus de
 * ads_read. `META_SOCIAL_TOKEN`, s'il existe, passe devant : un jeton à part.
 *
 * La page se retrouve par le jeton (`me/accounts`) ; `META_PAGE_ID` choisit
 * s'il y en a plusieurs, sinon la première qui a un compte Instagram relié.
 *
 * Instagram va chercher ses images à une adresse publique, ce que le poste
 * local n'a pas : une image envoyée en fichier passe d'abord par la page
 * Facebook, en photo non publiée, et Instagram la reprend sur le CDN de Meta.
 * Les vidéos montent directement (envoi « resumable »), sans adresse.
 */
import type { Check, Draft, Entry, Format, Media, Network, Result } from './common'
import { bad, blob, http, wait } from './common'

const VERSION = 'v26.0'
const GRAPH = `https://graph.facebook.com/${VERSION}`
const VIDEO = `https://graph-video.facebook.com/${VERSION}`
const RUPLOAD = 'https://rupload.facebook.com'
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish']

type Page = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }

const env = () => process.env.META_SOCIAL_TOKEN?.trim() || process.env.META_ADS_TOKEN?.trim()
function userToken() {
  const t = env()
  if (!t) throw bad('Meta : META_ADS_TOKEN manquant au .env')
  return t
}

const get = <T>(path: string, token: string, query: Record<string, unknown> = {}) =>
  http<T>('Meta', path.startsWith('https://') ? path : `${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` }, query })

/** Graph prend ses paramètres en formulaire ; les listes s'y écrivent en JSON. */
function post<T>(path: string, token: string, params: Record<string, unknown>) {
  const form: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') form[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return http<T>('Meta', path.startsWith('https://') ? path : `${GRAPH}/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, form,
  })
}

async function findPage(): Promise<Page> {
  const { data } = await get<{ data: Page[] }>('me/accounts', userToken(), {
    fields: 'id,name,access_token,instagram_business_account{id,username}',
  })
  const wanted = process.env.META_PAGE_ID?.trim()
  const page = wanted ? data.find(p => p.id === wanted) : data.find(p => p.instagram_business_account) ?? data[0]
  if (!page) throw createError({ statusCode: 502, statusMessage: wanted ? `Meta : la page ${wanted} n’est pas attribuée à ce jeton` : 'Meta : aucune page Facebook attribuée à ce jeton' })
  return page
}

/** Envoi direct d'une vidéo (Reels Facebook et Instagram) : les octets, ou l'adresse dans `file_url`. */
async function rupload(url: string, token: string, m: Media) {
  const headers: Record<string, string> = { Authorization: `OAuth ${token}` }
  if (m.data) {
    headers.offset = '0'
    headers.file_size = String(m.data.length)
  } else headers.file_url = m.url!
  await http('Meta', url, { method: 'POST', headers, body: m.data ? blob(m.data, m.type) : undefined })
}

/** Une photo sur la page ; non publiée, elle sert de pièce jointe, de story ou d'hébergement pour Instagram. */
async function photo(page: Page, m: Media, published: boolean, message?: string) {
  const form = new FormData()
  if (m.data) form.set('source', blob(m.data, m.type), m.name)
  else form.set('url', m.url!)
  form.set('published', String(published))
  if (message) form.set('message', message)
  return http<{ id: string; post_id?: string }>('Meta', `${GRAPH}/${page.id}/photos`, {
    method: 'POST', headers: { Authorization: `Bearer ${page.access_token}` }, body: form,
  })
}

/** Reels et stories vidéo de la page : ouverture, envoi, clôture. */
async function phased(page: Page, edge: 'video_reels' | 'video_stories', m: Media, finish: Record<string, unknown>) {
  const start = await post<{ video_id: string; upload_url?: string }>(`${page.id}/${edge}`, page.access_token, { upload_phase: 'start' })
  await rupload(start.upload_url ?? `${RUPLOAD}/video-upload/${VERSION}/${start.video_id}`, page.access_token, m)
  const done = await post<{ post_id?: string }>(`${page.id}/${edge}`, page.access_token, { upload_phase: 'finish', video_id: start.video_id, ...finish })
  return { videoId: start.video_id, postId: done.post_id }
}

/**
 * Le jeton, ses permissions et son échéance, communs aux deux onglets. Les
 * permissions se lisent par `me/permissions`, que tout jeton lit sur lui-même ;
 * `debug_token`, qui donne l'échéance, refuse les utilisateurs système qui ne
 * possèdent pas l'app : sans lui, on ne dit rien de l'échéance.
 */
async function tokenChecks(): Promise<Check[]> {
  const t = userToken()
  const me = await get<{ id: string; name?: string }>('me', t, { fields: 'id,name' }).catch((e: { statusMessage?: string }) => e)
  if (!('id' in me)) return [{ id: 'token', label: 'Jeton', state: 'bad', detail: `refusé : ${me.statusMessage ?? 'Meta ne le reconnaît pas'} ; en générer un autre dans les paramètres du portfolio` }]
  const [{ data: perms }, debug] = await Promise.all([
    get<{ data: { permission: string; status: string }[] }>('me/permissions', t),
    get<{ data: { expires_at?: number; data_access_expires_at?: number } }>('debug_token', t, { input_token: t }).then(r => r.data).catch(() => null),
  ])
  const ends = [debug?.expires_at, debug?.data_access_expires_at].filter((s): s is number => !!s).map(s => s * 1000)
  const end = ends.length ? Math.min(...ends) : null
  const out: Check[] = [{
    id: 'token', label: 'Jeton',
    state: end && end - Date.now() < 7 * 86400_000 ? 'warn' : 'ok',
    detail: `${me.name ?? me.id}${end ? `, expire le ${new Date(end).toLocaleDateString('fr-FR')}` : debug ? ', sans expiration' : ''}`,
  }]
  const granted = perms.filter(p => p.status === 'granted').map(p => p.permission)
  const missing = SCOPES.filter(s => !granted.includes(s))
  out.push(missing.length
    ? { id: 'scope', label: 'Permissions', state: 'bad', detail: `a ${granted.join(', ') || 'aucune'} ; manquent ${missing.join(', ')} : régénérer le jeton en les cochant` }
    : { id: 'scope', label: 'Permissions', state: 'ok', detail: SCOPES.join(', ') })
  return out
}

const SETUP_STEPS = [
  'Sur business.facebook.com, Paramètres → Utilisateurs système → « monitor » : lui attribuer la page Facebook et le compte Instagram de FarNight, avec le droit de publier.',
  'Dans l’app farnight_app, ajouter les produits « Facebook Login for Business » et « Instagram » (API avec connexion Facebook).',
  `Régénérer son jeton sans expiration en gardant ads_read et en ajoutant ${SCOPES.join(', ')}, business_management.`,
  'Le remettre au .env dans META_ADS_TOKEN : un seul jeton pour le moniteur et les réseaux (META_PAGE_ID=… s’il y a plusieurs pages).',
  'Le compte Instagram doit être professionnel et relié à la page.',
]
const setup = () => ({ env: ['META_ADS_TOKEN', 'META_PAGE_ID (facultatif)'], steps: SETUP_STEPS, oauth: false })

/* Instagram */

async function igAccount() {
  const page = await findPage()
  const ig = page.instagram_business_account
  if (!ig) throw createError({ statusCode: 502, statusMessage: `Meta : aucun compte Instagram relié à la page ${page.name}` })
  return { page, ig }
}

/** L'adresse publique d'une image pour Instagram ; voir l'en-tête. */
async function hosted(page: Page, m: Media) {
  if (m.url) return m.url
  const { id } = await photo(page, m, false)
  const { images } = await get<{ images: { width: number; source: string }[] }>(id, page.access_token, { fields: 'images' })
  const best = images.sort((a, b) => b.width - a.width)[0]
  if (!best) throw createError({ statusCode: 502, statusMessage: 'Meta : la photo relais n’a pas d’adresse' })
  return best.source
}

/** Un conteneur Instagram pour un média ; `params` porte media_type, caption, is_carousel_item… */
async function container(page: Page, igId: string, m: Media, params: Record<string, unknown>) {
  const token = userToken()
  if (m.kind === 'image') {
    return (await post<{ id: string }>(`${igId}/media`, token, { image_url: await hosted(page, m), ...params })).id
  }
  const c = await post<{ id: string; uri?: string }>(`${igId}/media`, token, { media_type: 'VIDEO', upload_type: 'resumable', ...params })
  await rupload(c.uri ?? `${RUPLOAD}/ig-api-upload/${VERSION}/${c.id}`, token, m)
  return c.id
}

type Status = { status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'; status?: string }
const status = (id: string) => get<Status>(id, userToken(), { fields: 'status_code,status' })

/** Attend qu'Instagram ait digéré le conteneur ; false si le délai passe. */
async function ready(id: string, budget: number) {
  for (const end = Date.now() + budget; ;) {
    const s = await status(id)
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return true
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw createError({ statusCode: 502, statusMessage: `Instagram : média refusé (${s.status ?? s.status_code})` })
    }
    if (Date.now() > end) return false
    await wait(4000)
  }
}

async function publishContainer(igId: string, id: string) {
  const token = userToken()
  const media = await post<{ id: string }>(`${igId}/media_publish`, token, { creation_id: id })
  const { permalink } = await get<{ permalink?: string }>(media.id, token, { fields: 'permalink' })
  return { ref: media.id, url: permalink }
}

const igFormats: Format[] = [
  {
    id: 'post', label: 'Publication',
    text: { label: 'Légende', max: 2200 },
    media: { kinds: ['image'], min: 1, max: 1, files: true, urls: true },
    note: 'Une image, du 4:5 au 1.91:1. Une vidéo seule part en Reel.',
  },
  {
    id: 'carousel', label: 'Carrousel',
    text: { label: 'Légende', max: 2200 },
    media: { kinds: ['image', 'video'], min: 2, max: 10, files: true, urls: true },
    note: 'De 2 à 10 images ou vidéos, dans l’ordre de la liste ; Instagram les cadre comme la première.',
  },
  {
    id: 'reel', label: 'Reel',
    text: { label: 'Légende', max: 2200 },
    media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
    options: [{ id: 'share_to_feed', label: 'Aussi dans le fil', type: 'check', default: true }],
    note: '9:16, de 3 s à 15 min.',
  },
  {
    id: 'story', label: 'Story',
    media: { kinds: ['image', 'video'], min: 1, max: 1, files: true, urls: true },
    note: '9:16, sans légende. Le sticker lien se pose à la main dans l’appli.',
  },
]

export const instagram: Network = {
  id: 'instagram',
  label: 'Instagram',
  formats: igFormats,
  setup,
  ready: () => !!env(),
  connected: async () => !!env(),

  async scan() {
    const checks = await tokenChecks()
    if (checks.some(c => c.state === 'bad')) return { checks }
    const { page, ig } = await igAccount().catch((e: { statusMessage?: string }) => {
      checks.push({ id: 'account', label: 'Compte', state: 'bad', detail: e.statusMessage ?? 'introuvable' })
      return { page: null, ig: null }
    })
    if (!page || !ig) return { checks }
    const token = userToken()
    const me = await get<{ username: string; followers_count?: number }>(ig.id, token, { fields: 'username,followers_count' })
    checks.push({ id: 'account', label: 'Compte', state: 'ok', detail: `@${me.username}, relié à la page ${page.name}` })
    const { data } = await get<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>(
      `${ig.id}/content_publishing_limit`, token, { fields: 'config,quota_usage' },
    )
    const used = data[0]?.quota_usage ?? 0
    const total = data[0]?.config?.quota_total ?? 100
    checks.push({ id: 'quota', label: 'Quota', state: used >= total ? 'bad' : used > total * 0.8 ? 'warn' : 'ok', detail: `${used} / ${total} publications sur 24 h` })
    return { account: `@${me.username}${me.followers_count != null ? ` · ${me.followers_count} abonnés` : ''}`, checks }
  },

  async repair() {
    throw bad('Instagram : rien à renouveler, le jeton de l’utilisateur système n’expire pas')
  },

  async publish(d: Draft): Promise<Result> {
    const { page, ig } = await igAccount()
    let id: string
    if (d.format === 'carousel') {
      const children: string[] = []
      for (const m of d.media) children.push(await container(page, ig.id, m, { is_carousel_item: true }))
      for (const c of children) await ready(c, 10 * 60_000)
      id = (await post<{ id: string }>(`${ig.id}/media`, userToken(), { media_type: 'CAROUSEL', children: children.join(','), caption: d.text })).id
    } else if (d.format === 'reel') {
      id = await container(page, ig.id, d.media[0]!, { media_type: 'REELS', caption: d.text, share_to_feed: d.options.share_to_feed !== false })
    } else if (d.format === 'story') {
      id = await container(page, ig.id, d.media[0]!, { media_type: 'STORIES' })
    } else {
      id = await container(page, ig.id, d.media[0]!, { caption: d.text })
    }
    // Au-delà du délai, la publication reste au journal ; l'onglet Info l'achève.
    if (!await ready(id, d.media.some(m => m.kind === 'video') ? 5 * 60_000 : 60_000)) {
      return { ref: `container:${id}`, state: 'pending', detail: 'Instagram traite encore le média' }
    }
    return { ...await publishContainer(ig.id, id), state: 'done' }
  },

  async follow(e: Entry, act: boolean) {
    if (!e.ref.startsWith('container:')) return { state: 'done' }
    const id = e.ref.slice('container:'.length)
    const s = await status(id)
    if (s.status_code === 'PUBLISHED') return { state: 'done', detail: 'publié' }
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') return { state: 'failed', detail: s.status ?? s.status_code }
    if (s.status_code !== 'FINISHED') return { detail: 'Instagram traite encore le média' }
    if (!act) return { detail: 'prêt, reste à publier (Réparer)' }
    const { ig } = await igAccount()
    return { ...await publishContainer(ig.id, id), state: 'done', detail: undefined }
  },
}

/* Facebook */

const fbFormats: Format[] = [
  {
    id: 'text', label: 'Texte',
    text: { label: 'Message', max: 63206, required: true },
    options: [{ id: 'link', label: 'Lien (aperçu sous le texte)', type: 'text', default: '' }],
  },
  {
    id: 'photos', label: 'Photos',
    text: { label: 'Message', max: 63206 },
    media: { kinds: ['image'], min: 1, max: 10, files: true, urls: true },
    note: 'De 1 à 10 images dans un même post.',
  },
  {
    id: 'video', label: 'Vidéo',
    title: { label: 'Titre', max: 255 },
    text: { label: 'Description', max: 63206 },
    media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
  },
  {
    id: 'reel', label: 'Reel',
    text: { label: 'Description', max: 2200 },
    media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
    note: '9:16, de 3 à 90 s ; 30 Reels par 24 h.',
  },
  {
    id: 'story', label: 'Story',
    media: { kinds: ['image', 'video'], min: 1, max: 1, files: true, urls: true },
    note: '9:16, sans texte.',
  },
]

export const facebook: Network = {
  id: 'facebook',
  label: 'Facebook',
  formats: fbFormats,
  setup,
  ready: () => !!env(),
  connected: async () => !!env(),

  async scan() {
    const checks = await tokenChecks()
    if (checks.some(c => c.state === 'bad')) return { checks }
    const page = await findPage().catch((e: { statusMessage?: string }) => {
      checks.push({ id: 'page', label: 'Page', state: 'bad', detail: e.statusMessage ?? 'introuvable' })
      return null
    })
    if (!page) return { checks }
    const info = await get<{ name: string; followers_count?: number }>(page.id, page.access_token, { fields: 'name,followers_count' })
    checks.push({ id: 'page', label: 'Page', state: 'ok', detail: `${info.name} (${page.id})` })
    return { account: `${info.name}${info.followers_count != null ? ` · ${info.followers_count} abonnés` : ''}`, checks }
  },

  async repair() {
    throw bad('Facebook : rien à renouveler, le jeton de l’utilisateur système n’expire pas')
  },

  async publish(d: Draft): Promise<Result> {
    const page = await findPage()
    const token = page.access_token
    const m = d.media[0]
    if (d.format === 'text') {
      const { id } = await post<{ id: string }>(`${page.id}/feed`, token, { message: d.text, link: d.options.link })
      return { ref: id, url: `https://www.facebook.com/${id}`, state: 'done' }
    }
    if (d.format === 'photos') {
      if (d.media.length === 1) {
        const r = await photo(page, m!, true, d.text)
        return { ref: r.post_id ?? r.id, url: `https://www.facebook.com/${r.post_id ?? r.id}`, state: 'done' }
      }
      const ids: string[] = []
      for (const x of d.media) ids.push((await photo(page, x, false)).id)
      const { id } = await post<{ id: string }>(`${page.id}/feed`, token, { message: d.text, attached_media: ids.map(media_fbid => ({ media_fbid })) })
      return { ref: id, url: `https://www.facebook.com/${id}`, state: 'done' }
    }
    if (d.format === 'video') {
      const form = new FormData()
      if (m!.data) form.set('source', blob(m!.data, m!.type), m!.name)
      else form.set('file_url', m!.url!)
      if (d.title) form.set('title', d.title)
      if (d.text) form.set('description', d.text)
      const { id } = await http<{ id: string }>('Meta', `${VIDEO}/${page.id}/videos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      return { ref: `video:${id}`, url: `https://www.facebook.com/${page.id}/videos/${id}`, state: 'pending', detail: 'Facebook traite la vidéo' }
    }
    if (d.format === 'reel') {
      const { videoId } = await phased(page, 'video_reels', m!, { video_state: 'PUBLISHED', description: d.text })
      return { ref: `video:${videoId}`, url: `https://www.facebook.com/reel/${videoId}`, state: 'pending', detail: 'Facebook traite le Reel' }
    }
    // Story
    if (m!.kind === 'image') {
      const { id } = await photo(page, m!, false)
      const r = await post<{ post_id?: string }>(`${page.id}/photo_stories`, token, { photo_id: id })
      return { ref: r.post_id ?? id, state: 'done' }
    }
    const { videoId, postId } = await phased(page, 'video_stories', m!, {})
    return { ref: postId ?? `video:${videoId}`, state: 'done' }
  },

  async follow(e: Entry) {
    if (!e.ref.startsWith('video:')) return { state: 'done' }
    const page = await findPage()
    const { status } = await get<{ status?: { video_status?: string; processing_phase?: { status?: string; error?: { message?: string } } } }>(
      e.ref.slice('video:'.length), page.access_token, { fields: 'status' },
    )
    if (status?.video_status === 'ready') return { state: 'done', detail: 'en ligne' }
    if (status?.video_status === 'error' || status?.processing_phase?.status === 'error') {
      return { state: 'failed', detail: status.processing_phase?.error?.message ?? 'refusée au traitement' }
    }
    return { detail: `Facebook traite la vidéo (${status?.video_status ?? 'en cours'})` }
  },
}
