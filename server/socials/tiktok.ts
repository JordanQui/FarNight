/**
 * TikTok, par la Content Posting API (developers.tiktok.com). Ce n'est pas
 * l'app TikTok API for Business de /nimda/monitor : c'en est une autre, à
 * part, avec `TIKTOK_CLIENT_KEY` et `TIKTOK_CLIENT_SECRET` au .env local.
 *
 * TikTok n'accepte comme adresse de retour qu'une https déclarée : il renvoie
 * donc sur farnight.online, où /nimda répond 404, et l'adresse de la barre se
 * colle dans la page. Jeton d'un jour, renouvelable un an.
 *
 * Tant que TikTok n'a pas audité l'app, il ne publie que sur un compte privé,
 * en « moi seulement ». Les photos ne montent pas en fichier : TikTok les tire
 * d'une adresse publique sur un domaine vérifié chez lui.
 */
import type { Draft, Entry, Media, Network, Result, Saved } from './common'
import { bad, http, oauth, request } from './common'

const OPEN = 'https://open.tiktokapis.com/v2'
const REDIRECT = 'https://farnight.online/nimda/socials'
const MB = 1024 * 1024

const key = () => process.env.TIKTOK_CLIENT_KEY?.trim()
const secret = () => process.env.TIKTOK_CLIENT_SECRET?.trim()

async function token(form: Record<string, string>): Promise<Saved> {
  const r = await http<{ access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; scope: string }>(
    'TikTok', `${OPEN}/oauth/token/`, { method: 'POST', form: { client_key: key()!, client_secret: secret()!, ...form } },
  )
  const now = Date.now()
  return {
    access: r.access_token,
    refresh: r.refresh_token,
    expiresAt: now + r.expires_in * 1000,
    refreshExpiresAt: now + r.refresh_expires_in * 1000,
    scope: r.scope.split(','),
    at: new Date().toISOString(),
  }
}

const auth = oauth({
  id: 'tiktok',
  label: 'TikTok',
  scopes: ['user.info.basic', 'video.publish', 'video.upload'],
  redirect: () => REDIRECT,
  url: ({ redirect, state }) => `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
    client_key: key()!, scope: 'user.info.basic,video.publish,video.upload', response_type: 'code', redirect_uri: redirect, state,
  })}`,
  exchange: (code, p) => token({ code, grant_type: 'authorization_code', redirect_uri: p.redirect }),
  refresh: s => token({ grant_type: 'refresh_token', refresh_token: s.refresh! }),
})

/** TikTok répond 200 même en échec : c'est `error.code` qui le dit. */
async function api<T>(path: string, body?: unknown, query?: Record<string, string>) {
  const r = await http<{ data: T; error?: { code: string; message: string } }>('TikTok', `${OPEN}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await auth.token()}` },
    json: body,
    query,
  })
  if (r.error && r.error.code !== 'ok') throw createError({ statusCode: 502, statusMessage: `TikTok : ${r.error.message || r.error.code}` })
  return r.data
}

type Creator = { creator_nickname?: string; creator_username?: string; privacy_level_options: string[]; max_video_post_duration_sec?: number }
const creator = () => api<Creator>('post/publish/creator_info/query/', {})

/**
 * D'où vient la vidéo : un fichier, envoyé d'un bloc jusqu'à 64 Mo, en
 * morceaux de 10 Mo au-delà (le dernier prend le reste) ; ou une adresse.
 */
async function source(m: Media) {
  if (!m.data) return { info: { source: 'PULL_FROM_URL', video_url: m.url }, data: null }
  const size = m.data.length
  const chunk = size <= 64 * MB ? size : 10 * MB
  return { info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: Math.floor(size / chunk) }, data: m.data }
}

async function upload(url: string, m: Media, data: Buffer, chunk: number, count: number) {
  for (let i = 0; i < count; i++) {
    const start = i * chunk
    const end = i === count - 1 ? data.length : start + chunk
    await request('TikTok', url, {
      method: 'PUT',
      headers: { 'Content-Type': m.type || 'video/mp4', 'Content-Range': `bytes ${start}-${end - 1}/${data.length}` },
      body: new Uint8Array(data.subarray(start, end)),
    })
  }
}

async function sendVideo(path: string, m: Media, postInfo?: Record<string, unknown>) {
  const { info, data } = await source(m)
  const r = await api<{ publish_id: string; upload_url?: string }>(path, { ...(postInfo && { post_info: postInfo }), source_info: info })
  if (data && r.upload_url) await upload(r.upload_url, m, data, info.chunk_size!, info.total_chunk_count!)
  return r.publish_id
}

const PRIVACY = [
  { value: 'SELF_ONLY', label: 'Moi seulement' },
  { value: 'PUBLIC_TO_EVERYONE', label: 'Tout le monde' },
  { value: 'FOLLOWER_OF_CREATOR', label: 'Abonnés' },
  { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Amis' },
]

async function privacy(d: Draft) {
  const allowed = (await creator()).privacy_level_options
  const wanted = String(d.options.privacy)
  if (!allowed.includes(wanted)) {
    throw bad(`TikTok n’accepte pour ce compte que : ${allowed.map(v => PRIVACY.find(p => p.value === v)?.label ?? v).join(', ')}`)
  }
  return wanted
}

export const tiktok: Network = {
  id: 'tiktok',
  label: 'TikTok',
  formats: [
    {
      id: 'video', label: 'Vidéo',
      text: { label: 'Légende', max: 2200 },
      media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
      options: [
        { id: 'privacy', label: 'Visible par', type: 'select', default: 'SELF_ONLY', choices: PRIVACY },
        { id: 'is_aigc', label: 'Contenu généré par IA', type: 'check', default: true },
        { id: 'brand_organic_toggle', label: 'Promeut ma propre activité', type: 'check', default: false },
        { id: 'disable_comment', label: 'Sans commentaires', type: 'check', default: false },
        { id: 'disable_duet', label: 'Sans duo', type: 'check', default: false },
        { id: 'disable_stitch', label: 'Sans collage', type: 'check', default: false },
      ],
      note: 'Publiée directement. Une adresse doit être sur un domaine vérifié chez TikTok.',
    },
    {
      id: 'draft', label: 'Brouillon vidéo',
      media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
      note: 'La vidéo arrive dans la boîte de réception de l’appli TikTok : légende, son et publication se font là.',
    },
    {
      id: 'photos', label: 'Photos',
      title: { label: 'Titre', max: 90 },
      text: { label: 'Description', max: 4000 },
      media: { kinds: ['image'], min: 1, max: 35, files: false, urls: true },
      options: [
        { id: 'post_mode', label: 'Envoi', type: 'select', default: 'DIRECT_POST', choices: [{ value: 'DIRECT_POST', label: 'Publier' }, { value: 'MEDIA_UPLOAD', label: 'Brouillon dans l’appli' }] },
        { id: 'privacy', label: 'Visible par', type: 'select', default: 'SELF_ONLY', choices: PRIVACY },
        { id: 'auto_add_music', label: 'Musique ajoutée par TikTok', type: 'check', default: true },
        { id: 'disable_comment', label: 'Sans commentaires', type: 'check', default: false },
      ],
      note: 'Jusqu’à 35 images, par adresses publiques sur un domaine vérifié chez TikTok (pas de fichier).',
    },
  ],

  setup: () => ({
    env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    redirect: REDIRECT,
    oauth: true,
    steps: [
      'Sur developers.tiktok.com, Manage apps : créer une app (plateforme Web), avec les produits Login Kit et Content Posting API (Direct Post activé).',
      'Permissions : user.info.basic, video.publish, video.upload.',
      `Redirect URI : ${REDIRECT}.`,
      'Copier Client key et Client secret au .env : TIKTOK_CLIENT_KEY=…, TIKTOK_CLIENT_SECRET=…',
      'Brancher : TikTok revient sur farnight.online (page introuvable), coller ici l’adresse de la barre.',
      'Sans audit TikTok, tout part en « moi seulement » et le compte doit être privé.',
    ],
  }),
  ready: () => !!key() && !!secret(),
  connected: auth.connected,
  authorize: auth.authorize,
  connect: auth.connect,
  repair: auth.repair,

  async scan() {
    const checks = await auth.checks()
    if (checks.some(c => c.state === 'bad')) return { checks }
    const { user } = await api<{ user: { display_name: string } }>('user/info/', undefined, { fields: 'open_id,display_name' })
    const c = await creator()
    const open = c.privacy_level_options.filter(v => v !== 'SELF_ONLY')
    checks.push({
      id: 'audit', label: 'Visibilité',
      state: open.length ? 'ok' : 'warn',
      detail: open.length
        ? c.privacy_level_options.map(v => PRIVACY.find(p => p.value === v)?.label ?? v).join(', ')
        : 'moi seulement : app pas encore auditée par TikTok',
    })
    if (c.max_video_post_duration_sec) checks.push({ id: 'duration', label: 'Durée max', state: 'ok', detail: `${c.max_video_post_duration_sec} s par vidéo` })
    return { account: `${user.display_name}${c.creator_username ? ` (@${c.creator_username})` : ''}`, checks }
  },

  async publish(d: Draft): Promise<Result> {
    if (d.format === 'draft') {
      const id = await sendVideo('post/publish/inbox/video/init/', d.media[0]!)
      return { ref: id, state: 'pending', detail: 'envoyée vers la boîte de réception TikTok' }
    }
    if (d.format === 'photos') {
      if (d.media.some(m => !m.url)) throw bad('TikTok ne prend les photos que par adresse publique')
      const direct = d.options.post_mode !== 'MEDIA_UPLOAD'
      const r = await api<{ publish_id: string }>('post/publish/content/init/', {
        media_type: 'PHOTO',
        post_mode: direct ? 'DIRECT_POST' : 'MEDIA_UPLOAD',
        post_info: {
          title: d.title, description: d.text,
          disable_comment: !!d.options.disable_comment, auto_add_music: !!d.options.auto_add_music,
          ...(direct && { privacy_level: await privacy(d) }),
        },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: d.media.map(m => m.url) },
      })
      return { ref: r.publish_id, state: 'pending', detail: 'TikTok récupère les images' }
    }
    const id = await sendVideo('post/publish/video/init/', d.media[0]!, {
      title: d.text,
      privacy_level: await privacy(d),
      disable_comment: !!d.options.disable_comment,
      disable_duet: !!d.options.disable_duet,
      disable_stitch: !!d.options.disable_stitch,
      is_aigc: !!d.options.is_aigc,
      brand_organic_toggle: !!d.options.brand_organic_toggle,
      brand_content_toggle: false,
    })
    return { ref: id, state: 'pending', detail: 'TikTok traite la vidéo' }
  },

  async follow(e: Entry) {
    const s = await api<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
      'post/publish/status/fetch/', { publish_id: e.ref },
    )
    if (s.status === 'PUBLISH_COMPLETE') return { state: 'done', detail: s.publicaly_available_post_id?.length ? `en ligne (${s.publicaly_available_post_id[0]})` : 'publiée' }
    if (s.status === 'SEND_TO_USER_INBOX') return { state: 'done', detail: 'dans la boîte de réception de l’appli' }
    if (s.status === 'FAILED') return { state: 'failed', detail: s.fail_reason ?? 'refusée' }
    return { detail: `TikTok traite (${s.status.toLowerCase().replace(/_/g, ' ')})` }
  },
}
