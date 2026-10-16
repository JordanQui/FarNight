/**
 * L'état des réseaux et sa réparation, pour l'onglet Info de /nimda/socials.
 *
 * GET lit tout : identifiants, jeton, permissions, compte, quotas, et relit
 * les publications restées en cours (lecture seule, rien n'est publié).
 * POST `{ network, fix }` répare : `refresh` renouvelle le jeton, `forget`
 * l'oublie pour rebrancher, `pending` achève ou relit les publications en
 * cours (Instagram publie alors un conteneur prêt).
 */
import type { Check, Entry } from '../../../socials/common'
import { NETWORKS, network } from '../../../socials'
import { amend, bad, failure, journal } from '../../../socials/common'

export default defineEventHandler(async (event) => {
  if (event.method === 'POST') {
    const body = await readBody<{ network?: string; fix?: string }>(event).catch(() => null)
    const n = network(body?.network)
    if (body?.fix === 'pending') {
      const pending = (await journal()).filter(e => e.network === n.id && e.state === 'pending')
      const patches = new Map<string, Partial<Entry>>()
      for (const e of pending) {
        try {
          patches.set(e.id, n.follow ? await n.follow(e, true) : { state: 'done' })
        } catch (err) {
          patches.set(e.id, { detail: failure(err) })
        }
      }
      await amend(patches)
      const finished = [...patches.values()].filter(p => p.state && p.state !== 'pending').length
      return { message: `${n.label} : ${finished} sur ${pending.length} publication(s) réglée(s)` }
    }
    if (body?.fix !== 'refresh' && body?.fix !== 'forget') throw bad('réparation inconnue')
    return { message: await n.repair(body.fix) }
  }

  const port = getRequestURL(event).port || '3000'
  const list = await journal()
  const patches = new Map<string, Partial<Entry>>()
  const networks = await Promise.all(NETWORKS.map(async (n) => {
    if (!n.ready()) {
      const checks: Check[] = [{ id: 'env', label: 'Identifiants', state: 'off', detail: `à mettre au .env : ${n.setup(port).env.join(', ')}` }]
      return { id: n.id, label: n.label, account: undefined as string | undefined, checks }
    }
    const result = await n.scan().catch(e => ({
      account: undefined as string | undefined,
      checks: [{ id: 'scan', label: 'Lecture', state: 'bad', detail: failure(e) }] as Check[],
    }))
    let left = 0
    for (const e of list.filter(e => e.network === n.id && e.state === 'pending')) {
      try {
        const patch = n.follow ? await n.follow(e, false) : { state: 'done' as const }
        patches.set(e.id, patch)
        if ((patch.state ?? e.state) === 'pending') left++
      } catch (err) {
        patches.set(e.id, { detail: failure(err) })
        left++
      }
    }
    if (left) result.checks.push({ id: 'pending', label: 'En cours', state: 'warn', detail: `${left} publication(s) pas encore en ligne`, fix: 'pending' })
    return { id: n.id, label: n.label, account: result.account, checks: result.checks }
  }))
  await amend(patches)
  return { networks, journal: await journal(), at: new Date().toISOString() }
})
