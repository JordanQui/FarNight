import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { vercelJson, vercelProject } from '~/server/utils/vercel-cli'

/**
 * La prod en ce moment : ce qui tourne, depuis quand, si ça répond, ce que
 * Vercel facture. Données de pages/nimda/monitor.vue.
 *
 * Chaque source peut manquer sans emporter les autres : son erreur part dans
 * `errors` et la page affiche le reste.
 *
 * La facture part du point de départ de la page (`?since=`, ISO), arrondi au
 * jour : Vercel ne la compte qu'en jours entiers, à l'heure de Los Angeles.
 */

type Production = { id: string; url: string; createdAt: number; readyState: string; meta?: Record<string, string> }
type Deployment = {
  url: string; state: string; target: string | null; createdAt: number; buildingAt?: number; ready?: number
  creator?: { username?: string }; meta?: Record<string, string>
}
type Usage = {
  period: { from: string; to: string }
  costUnit: string
  creditBalance?: { allocated: number; used: number; remaining: number }
  services: { name: string; quantity: number; unit: string; cost: number; category: string }[]
}

const laDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' })

const git = async (...args: string[]) =>
  (await promisify(execFile)('git', args, { cwd: process.cwd() })).stdout.trim()

async function statusPage(name: string, url: string) {
  const r = await $fetch<{ status: { indicator: string; description: string } }>('/api/v2/status.json', { baseURL: url, timeout: 8000 })
  return { name, url, indicator: r.status.indicator, description: r.status.description }
}

/** Depuis ce poste : la latence comprend notre propre connexion. */
async function probe(url: string) {
  const t0 = performance.now()
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  return { url, status: res.status, ms: Math.round(performance.now() - t0) }
}

export default defineEventHandler(async (event) => {
  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })
  const errors: Record<string, string> = {}
  const soft = <T>(name: string, p: Promise<T>) => p.catch((e: Error) => { errors[name] = e.message; return null })

  const { projectId, orgId } = await vercelProject()
  const api = <T>(path: string) => vercelJson<T>(['api', `${path}?teamId=${orgId}`, '--raw'])

  const [project, domains, list, env, alerts, usage, ...status] = await Promise.all([
    soft('projet', api<{ name: string; framework?: string; nodeVersion?: string; serverlessFunctionRegion?: string; targets?: { production?: Production } }>(`/v9/projects/${projectId}`)),
    soft('domaines', api<{ domains: { name: string; verified: boolean; redirect: string | null }[] }>(`/v9/projects/${projectId}/domains`)),
    soft('déploiements', vercelJson<{ contextName: string; deployments: Deployment[] }>(['ls', '--json', '--limit', '12'])),
    soft('variables', vercelJson<{ envs: { key: string; target?: string[]; type: string; updatedAt: number }[] }>(['env', 'ls', '--json'])),
    soft('alertes', vercelJson<{ groups: Record<string, unknown>[] }>(['alerts', '--json'])),
    soft('facture', vercelJson<Usage>(['usage', '--json', '--from', laDay(since), '--to', laDay(new Date())])),
    soft('statut Vercel', statusPage('Vercel', 'https://www.vercel-status.com')),
    soft('statut OpenAI', statusPage('OpenAI', 'https://status.openai.com')),
  ])

  // Le déploiement servi, pas le dernier construit : un rollback les sépare.
  const prod = project?.targets?.production ?? null
  const sha = prod?.meta?.githubCommitSha ?? null
  const host = domains?.domains.find(d => d.verified && !d.redirect && !d.name.endsWith('.vercel.app'))?.name ?? null

  const [ping, ahead] = await Promise.all([
    host ? soft('site', probe(`https://${host}/`)) : null,
    sha ? soft('git', git('rev-list', '--count', `${sha}..HEAD`)) : null,
  ])

  return {
    errors,
    dashboard: list && project ? `https://vercel.com/${list.contextName}/${project.name}` : null,
    project: project && {
      name: project.name,
      framework: project.framework ?? null,
      node: project.nodeVersion ?? null,
      region: project.serverlessFunctionRegion ?? null,
    },
    prod: prod && {
      url: prod.url,
      createdAt: prod.createdAt,
      state: prod.readyState,
      sha: sha?.slice(0, 7) ?? null,
      message: prod.meta?.githubCommitMessage ?? null,
    },
    host,
    ping,
    /** Commits du main local absents de la prod. */
    ahead: ahead == null ? null : Number(ahead),
    status: status.filter(s => s !== null),
    alerts: alerts?.groups.map(g => String(g.title ?? g.name ?? g.type ?? g.id)) ?? null,
    deployments: list?.deployments.map(d => ({
      url: d.url,
      state: d.state,
      target: d.target ?? 'preview',
      createdAt: d.createdAt,
      buildMs: d.ready && d.buildingAt ? d.ready - d.buildingAt : null,
      sha: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
      message: d.meta?.githubCommitMessage ?? null,
      live: d.url === prod?.url,
    })) ?? null,
    // Vercel n'applique une variable changée qu'aux déploiements suivants.
    env: env?.envs
      .filter(e => e.target?.includes('production'))
      .map(e => ({ key: e.key, type: e.type, updatedAt: e.updatedAt, stale: prod != null && e.updatedAt > prod.createdAt }))
      .sort((a, b) => a.key.localeCompare(b.key)) ?? null,
    usage: usage && {
      from: usage.period.from,
      to: usage.period.to,
      currency: usage.costUnit,
      credit: usage.creditBalance ?? null,
      total: usage.services.reduce((sum, s) => sum + s.cost, 0),
      /** Sans l'abonnement : ce que la prod a réellement consommé. */
      consumption: usage.services.filter(s => s.category === 'usage').reduce((sum, s) => sum + s.cost, 0),
      services: usage.services.filter(s => s.cost >= 0.005).sort((a, b) => b.cost - a.cost),
    },
  }
})
