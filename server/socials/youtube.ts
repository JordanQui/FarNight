/**
 * YouTube, par la Data API v3 : un projet Google Cloud, un identifiant OAuth
 * « Application Web » (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` au .env
 * local), retour sur localhost.
 *
 * Deux limites de Google, pas d'ici : tant que le projet n'est pas audité, les
 * vidéos envoyées par l'API restent privées ; tant que l'écran de consentement
 * est « en test », l'accès tombe au bout de sept jours. Les posts de la
 * communauté n'ont pas d'API.
 */
import type { Draft, Entry, Network, Result, Saved } from './common'
import { bytes, http, loadToken, oauth, request } from './common'

const TOKEN = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/youtube/v3'
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

const id = () => process.env.YOUTUBE_CLIENT_ID?.trim()
const secret = () => process.env.YOUTUBE_CLIENT_SECRET?.trim()

type Grant = { access_token: string; expires_in: number; refresh_token?: string; scope: string }
const saved = (r: Grant, refresh?: string): Saved => ({
  access: r.access_token,
  refresh: r.refresh_token ?? refresh,
  expiresAt: Date.now() + r.expires_in * 1000,
  scope: r.scope.split(' '),
  at: new Date().toISOString(),
})

const auth = oauth({
  id: 'youtube',
  label: 'YouTube',
  scopes: SCOPES,
  redirect: port => `http://localhost:${port}/nimda/socials`,
  url: ({ redirect, state }) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: id()!, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })}`,
  exchange: async (code, p) => saved(await http<Grant>('YouTube', TOKEN, {
    method: 'POST', form: { code, client_id: id()!, client_secret: secret()!, redirect_uri: p.redirect, grant_type: 'authorization_code' },
  })),
  // Google ne redonne pas de jeton de renouvellement : on garde l'ancien. Le relevé de branchement aussi.
  refresh: async s => ({
    ...saved(await http<Grant>('YouTube', TOKEN, {
      method: 'POST', form: { client_id: id()!, client_secret: secret()!, refresh_token: s.refresh!, grant_type: 'refresh_token' },
    }), s.refresh),
    at: s.at,
  }),
})

const CATEGORIES = [
  { value: '20', label: 'Jeux vidéo' },
  { value: '24', label: 'Divertissement' },
  { value: '1', label: 'Film et animation' },
  { value: '22', label: 'Vlog' },
]
const options = [
  { id: 'privacy', label: 'Visibilité', type: 'select' as const, default: 'public', choices: [{ value: 'public', label: 'Publique' }, { value: 'unlisted', label: 'Non répertoriée' }, { value: 'private', label: 'Privée' }] },
  { id: 'category', label: 'Catégorie', type: 'select' as const, default: '20', choices: CATEGORIES },
  { id: 'tags', label: 'Tags, séparés par des virgules', type: 'text' as const, default: '' },
  { id: 'notify', label: 'Prévenir les abonnés', type: 'check' as const, default: true },
  { id: 'kids', label: 'Conçue pour les enfants', type: 'check' as const, default: false },
]

export const youtube: Network = {
  id: 'youtube',
  label: 'YouTube',
  formats: [
    {
      id: 'video', label: 'Vidéo',
      title: { label: 'Titre', max: 100, required: true },
      text: { label: 'Description', max: 5000 },
      media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
      options,
    },
    {
      id: 'short', label: 'Short',
      title: { label: 'Titre', max: 100, required: true },
      text: { label: 'Description', max: 5000 },
      media: { kinds: ['video'], min: 1, max: 1, files: true, urls: true },
      options,
      note: 'Vertical ou carré, 3 min au plus : YouTube le classe en Short de lui-même.',
    },
  ],

  setup: port => ({
    env: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
    redirect: `http://localhost:${port}/nimda/socials`,
    oauth: true,
    steps: [
      'Sur console.cloud.google.com, dans un projet : activer « YouTube Data API v3 ».',
      'Écran de consentement OAuth, type externe ; s’ajouter en utilisateur test (ou publier l’app : en test, l’accès tombe au 7e jour).',
      `Identifiants → ID client OAuth « Application Web », URI de redirection http://localhost:${port}/nimda/socials.`,
      'Au .env : YOUTUBE_CLIENT_ID=…, YOUTUBE_CLIENT_SECRET=…',
      'Tant que Google n’a pas audité le projet, les vidéos envoyées par l’API restent privées.',
    ],
  }),
  ready: () => !!id() && !!secret(),
  connected: auth.connected,
  authorize: auth.authorize,
  connect: auth.connect,
  repair: auth.repair,

  async scan() {
    const checks = await auth.checks()
    if (checks.some(c => c.state === 'bad')) return { checks }
    const { items } = await http<{ items?: { snippet: { title: string }; statistics?: { subscriberCount?: string; videoCount?: string } }[] }>(
      'YouTube', `${API}/channels`, { headers: { Authorization: `Bearer ${await auth.token()}` }, query: { part: 'snippet,statistics', mine: true } },
    )
    const channel = items?.[0]
    checks.push(channel
      ? { id: 'channel', label: 'Chaîne', state: 'ok', detail: `${channel.snippet.title}, ${channel.statistics?.videoCount ?? 0} vidéos` }
      : { id: 'channel', label: 'Chaîne', state: 'bad', detail: 'ce compte Google n’a pas de chaîne', connect: true })
    const s = await loadToken('youtube')
    if (s && Date.now() - Date.parse(s.at) > 6 * 86400_000) {
      checks.push({ id: 'testing', label: 'Écran de consentement', state: 'warn', detail: 'branché il y a plus de 6 jours : si l’app Google est « en test », l’accès tombe au 7e', connect: true })
    }
    return { account: channel ? `${channel.snippet.title} · ${channel.statistics?.subscriberCount ?? '?'} abonnés` : undefined, checks }
  },

  async publish(d: Draft): Promise<Result> {
    const m = d.media[0]!
    const data = await bytes(m)
    const token = await auth.token()
    const meta = {
      snippet: {
        title: d.title,
        description: d.text,
        categoryId: String(d.options.category || '20'),
        tags: String(d.options.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
      },
      status: { privacyStatus: String(d.options.privacy || 'public'), selfDeclaredMadeForKids: !!d.options.kids },
    }
    // Envoi en deux temps : l'adresse d'envoi d'abord, avec les métadonnées, puis la vidéo d'un bloc.
    const init = await request('YouTube', 'https://www.googleapis.com/upload/youtube/v3/videos', {
      method: 'POST',
      query: { uploadType: 'resumable', part: 'snippet,status', notifySubscribers: d.options.notify !== false },
      headers: { 'Authorization': `Bearer ${token}`, 'X-Upload-Content-Type': m.type || 'video/mp4', 'X-Upload-Content-Length': String(data.length) },
      json: meta,
    })
    const location = init.headers.get('location')
    if (!location) throw createError({ statusCode: 502, statusMessage: 'YouTube : pas d’adresse d’envoi' })
    const video = await http<{ id: string }>('YouTube', location, {
      method: 'PUT', headers: { 'Content-Type': m.type || 'video/mp4' }, body: new Uint8Array(data),
    })
    return {
      ref: video.id,
      url: d.format === 'short' ? `https://www.youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`,
      state: 'pending',
      detail: 'YouTube traite la vidéo',
    }
  },

  async follow(e: Entry) {
    const { items } = await http<{ items?: { status: { uploadStatus: string; privacyStatus: string; rejectionReason?: string; failureReason?: string } }[] }>(
      'YouTube', `${API}/videos`, { headers: { Authorization: `Bearer ${await auth.token()}` }, query: { part: 'status', id: e.ref } },
    )
    const s = items?.[0]?.status
    if (!s) return { state: 'failed', detail: 'vidéo introuvable (supprimée ?)' }
    if (s.uploadStatus === 'processed') return { state: 'done', detail: `en ligne, ${s.privacyStatus}` }
    if (['rejected', 'failed', 'deleted'].includes(s.uploadStatus)) return { state: 'failed', detail: s.rejectionReason ?? s.failureReason ?? s.uploadStatus }
    return { detail: 'YouTube traite la vidéo' }
  },
}
