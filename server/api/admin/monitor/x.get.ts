/**
 * Ce que font les posts X, lus par l'API v2 avec le compte branché dans
 * /nimda/socials (jeton OAuth 2.0 de server/socials/x.ts, renouvelé seul).
 *
 * X ne découpe pas les chiffres d'un post dans le temps : seuls comptent les
 * posts publiés depuis le point de départ (`?since=`, ISO), avec tout ce
 * qu'ils ont fait depuis. Les abonnés sont ceux du moment.
 *
 * Chaque lecture se paie en crédits X (0,5 ct le post, 1 ct le compte), une
 * seule fois par jour UTC : X ne refacture pas ce qu'il a déjà rendu dans la
 * journée. Crédits épuisés, X refuse la lecture et l'erreur s'affiche.
 */
import { http, loadToken } from '../../../socials/common'
import { xToken } from '../../../socials/x'

const API = 'https://api.x.com/2'

type Post = {
  id: string
  text: string
  created_at: string
  public_metrics?: { impression_count?: number; like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number; bookmark_count?: number }
  /** Réservés à l'auteur, sur les posts de moins de 30 jours. */
  non_public_metrics?: { impression_count?: number; url_link_clicks?: number; user_profile_clicks?: number }
}

export default defineEventHandler(async (event) => {
  if (!process.env.X_CLIENT_ID?.trim() || !await loadToken('x')) return { configured: false as const }

  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })
  // Au-delà de 30 jours, X ne rend plus les clics : la lecture s'arrête là.
  const start = new Date(Math.max(since.getTime(), Date.now() - 29 * 86400_000))

  const headers = { Authorization: `Bearer ${await xToken()}` }
  const { data: me } = await http<{ data: { id: string; username: string; public_metrics: { followers_count: number } } }>('X', `${API}/users/me`, {
    headers, query: { 'user.fields': 'public_metrics' },
  })

  const posts: Post[] = []
  let next: string | undefined
  do {
    const r = await http<{ data?: Post[]; meta?: { next_token?: string } }>('X', `${API}/users/${me.id}/tweets`, {
      headers,
      query: {
        start_time: start.toISOString().replace(/\.\d+Z$/, 'Z'),
        exclude: 'retweets',
        max_results: 100,
        pagination_token: next,
        'tweet.fields': 'created_at,public_metrics,non_public_metrics',
      },
    })
    posts.push(...r.data ?? [])
    next = r.meta?.next_token
  } while (next)

  return {
    configured: true as const,
    account: `@${me.username}`,
    followers: me.public_metrics.followers_count,
    // X rend les plus récents d'abord ; la page les veut dans l'ordre de publication.
    posts: posts.reverse().map((p) => {
      const pub = p.public_metrics ?? {}
      const own = p.non_public_metrics ?? {}
      return {
        id: p.id,
        at: p.created_at,
        excerpt: p.text.slice(0, 60),
        impressions: own.impression_count ?? pub.impression_count ?? 0,
        engagements: (pub.like_count ?? 0) + (pub.retweet_count ?? 0) + (pub.reply_count ?? 0) + (pub.quote_count ?? 0) + (pub.bookmark_count ?? 0),
        clicks: own.url_link_clicks ?? 0,
        profile: own.user_profile_clicks ?? 0,
      }
    }),
  }
})
