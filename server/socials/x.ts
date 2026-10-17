/**
 * X, par l'API v2 : une app du portail développeur en OAuth 2.0 (PKCE),
 * `X_CLIENT_ID` et `X_CLIENT_SECRET` au .env local. X refuse « localhost »
 * comme adresse de retour : c'est 127.0.0.1, la page s'y rouvre. Jeton de
 * deux heures, renouvelé seul ; X change le jeton de renouvellement à chaque
 * fois.
 *
 * Les médias montent en morceaux (initialize, append, finalize) puis X les
 * traite : une vidéo n'est jointe qu'une fois prête.
 */
import type { Draft, Media, Network, Result, Saved } from './common'
import { bad, blob, bytes, http, oauth, request, wait } from './common'

const API = 'https://api.x.com/2'
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']
const CHUNK = 4 * 1024 * 1024

const id = () => process.env.X_CLIENT_ID?.trim()
const secret = () => process.env.X_CLIENT_SECRET?.trim()

/** App confidentielle : identifiants en Basic ; app publique : l'identifiant dans le formulaire. */
async function token(form: Record<string, string>): Promise<Saved> {
  const s = secret()
  const r = await http<{ access_token: string; expires_in: number; refresh_token?: string; scope: string }>('X', `${API}/oauth2/token`, {
    method: 'POST',
    headers: s ? { Authorization: `Basic ${Buffer.from(`${id()}:${s}`).toString('base64')}` } : {},
    form: s ? form : { ...form, client_id: id()! },
  })
  return {
    access: r.access_token,
    refresh: r.refresh_token,
    expiresAt: Date.now() + r.expires_in * 1000,
    scope: r.scope.split(' '),
    at: new Date().toISOString(),
  }
}

const auth = oauth({
  id: 'x',
  label: 'X',
  scopes: SCOPES,
  redirect: port => `http://127.0.0.1:${port}/nimda/socials`,
  url: ({ redirect, state, challenge }) => `https://x.com/i/oauth2/authorize?${new URLSearchParams({
    response_type: 'code', client_id: id()!, redirect_uri: redirect, scope: SCOPES.join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256',
  })}`,
  exchange: (code, p) => token({ grant_type: 'authorization_code', code, redirect_uri: p.redirect, code_verifier: p.verifier }),
  refresh: s => token({ grant_type: 'refresh_token', refresh_token: s.refresh! }),
})

/** Le moniteur lit les posts avec le même jeton, renouvelé au besoin. */
export const xToken = auth.token

type Processing = { state: 'pending' | 'in_progress' | 'succeeded' | 'failed'; check_after_secs?: number; error?: { message?: string } }

async function upload(m: Media) {
  const data = await bytes(m)
  const headers = { Authorization: `Bearer ${await auth.token()}` }
  const category = m.type === 'image/gif' ? 'tweet_gif' : m.kind === 'video' ? 'tweet_video' : 'tweet_image'
  const init = await http<{ data: { id: string } }>('X', `${API}/media/upload/initialize`, {
    method: 'POST', headers, json: { media_type: m.type, total_bytes: data.length, media_category: category },
  })
  const mediaId = init.data.id
  for (let start = 0, segment = 0; start < data.length; start += CHUNK, segment++) {
    const form = new FormData()
    form.set('segment_index', String(segment))
    form.set('media', blob(data.subarray(start, start + CHUNK), m.type), m.name)
    await request('X', `${API}/media/upload/${mediaId}/append`, { method: 'POST', headers, body: form })
  }
  let info = (await http<{ data: { processing_info?: Processing } }>('X', `${API}/media/upload/${mediaId}/finalize`, { method: 'POST', headers })).data.processing_info
  for (const end = Date.now() + 10 * 60_000; info && info.state !== 'succeeded';) {
    if (info.state === 'failed') throw createError({ statusCode: 502, statusMessage: `X : média refusé${info.error?.message ? ` (${info.error.message})` : ''}` })
    if (Date.now() > end) throw createError({ statusCode: 504, statusMessage: 'X : le traitement du média dépasse 10 min' })
    await wait((info.check_after_secs ?? 2) * 1000)
    info = (await http<{ data: { processing_info?: Processing } }>('X', `${API}/media/upload`, {
      headers, query: { command: 'STATUS', media_id: mediaId },
    })).data.processing_info
  }
  return mediaId
}

/** Quatre images, ou une seule vidéo, ou un seul GIF. */
async function attach(media: Media[]) {
  const single = media.filter(m => m.kind === 'video' || m.type === 'image/gif')
  if (single.length && media.length > 1) throw bad('X : une vidéo ou un GIF part seul, sans autre média')
  if (media.length > 4) throw bad('X : quatre images au plus')
  const ids: string[] = []
  for (const m of media) ids.push(await upload(m))
  return ids.length ? { media: { media_ids: ids } } : {}
}

async function tweet(body: Record<string, unknown>) {
  const { data } = await http<{ data: { id: string } }>('X', `${API}/tweets`, {
    method: 'POST', headers: { Authorization: `Bearer ${await auth.token()}` }, json: body,
  })
  return data.id
}

const link = (tweetId: string) => `https://x.com/i/web/status/${tweetId}`

export const x: Network = {
  id: 'x',
  label: 'X',
  formats: [
    {
      id: 'post', label: 'Post',
      text: { label: 'Texte (280 signes sans Premium)', max: 25000 },
      media: { kinds: ['image', 'video'], min: 0, max: 4, files: true, urls: true },
      note: 'Jusqu’à 4 images, ou une vidéo, ou un GIF.',
    },
    {
      id: 'thread', label: 'Fil',
      text: { label: 'Les posts du fil, séparés par une ligne ---', max: 100000, required: true },
      media: { kinds: ['image', 'video'], min: 0, max: 4, files: true, urls: true },
      note: 'Les médias vont sur le premier post.',
    },
    {
      id: 'poll', label: 'Sondage',
      text: { label: 'Question', max: 280, required: true },
      options: [
        { id: 'choices', label: 'Réponses, une par ligne (2 à 4, 25 signes)', type: 'lines', default: '' },
        { id: 'duration', label: 'Durée', type: 'select', default: '1440', choices: [
          { value: '60', label: '1 heure' }, { value: '360', label: '6 heures' }, { value: '1440', label: '1 jour' },
          { value: '4320', label: '3 jours' }, { value: '10080', label: '7 jours' },
        ] },
      ],
    },
  ],

  setup: port => ({
    env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    redirect: `http://127.0.0.1:${port}/nimda/socials`,
    oauth: true,
    steps: [
      'Sur developer.x.com, dans le projet : une app, « User authentication settings » en OAuth 2.0, type Web App, permissions Read and write.',
      `Callback URI : http://127.0.0.1:${port}/nimda/socials ; Website : https://farnight.online.`,
      'Au .env : X_CLIENT_ID=…, X_CLIENT_SECRET=… (les identifiants OAuth 2.0, pas la clé API).',
      'L’écriture dépend du forfait API du compte X (crédits ou abonnement).',
    ],
  }),
  ready: () => !!id(),
  connected: auth.connected,
  authorize: auth.authorize,
  connect: auth.connect,
  repair: auth.repair,

  async scan() {
    const checks = await auth.checks()
    if (checks.some(c => c.state === 'bad')) return { checks }
    const { data } = await http<{ data: { username: string; public_metrics?: { followers_count: number } } }>('X', `${API}/users/me`, {
      headers: { Authorization: `Bearer ${await auth.token()}` }, query: { 'user.fields': 'public_metrics' },
    })
    checks.push({ id: 'account', label: 'Compte', state: 'ok', detail: `@${data.username}` })
    return { account: `@${data.username}${data.public_metrics ? ` · ${data.public_metrics.followers_count} abonnés` : ''}`, checks }
  },

  async publish(d: Draft): Promise<Result> {
    if (d.format === 'poll') {
      const choices = String(d.options.choices ?? '').split('\n').map(l => l.trim()).filter(Boolean)
      if (choices.length < 2 || choices.length > 4) throw bad('X : un sondage a de 2 à 4 réponses')
      if (choices.some(c => c.length > 25)) throw bad('X : 25 signes au plus par réponse')
      const tweetId = await tweet({ text: d.text, poll: { options: choices, duration_minutes: Number(d.options.duration) || 1440 } })
      return { ref: tweetId, url: link(tweetId), state: 'done' }
    }
    if (d.format === 'thread') {
      const parts = d.text.split(/^\s*---\s*$/m).map(p => p.trim()).filter(Boolean)
      if (!parts.length) throw bad('X : le fil est vide')
      const first = await tweet({ text: parts[0], ...await attach(d.media) })
      let previous = first
      for (const text of parts.slice(1)) previous = await tweet({ text, reply: { in_reply_to_tweet_id: previous } })
      return { ref: first, url: link(first), state: 'done', detail: `${parts.length} posts` }
    }
    if (!d.text && !d.media.length) throw bad('X : un post a du texte ou un média')
    const tweetId = await tweet({ ...(d.text && { text: d.text }), ...await attach(d.media) })
    return { ref: tweetId, url: link(tweetId), state: 'done' }
  },
}
