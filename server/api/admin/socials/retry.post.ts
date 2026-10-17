/**
 * Relancer un post refusé depuis /nimda/socials : `{ id }` d'une ligne rouge
 * du journal. Le brouillon gardé par publish.post.ts repart tel quel ; s'il
 * passe, la ligne devient celle du post publié et le brouillon est oublié.
 */
import { network } from '../../../socials'
import { amend, bad, dropDraft, failure, journal, loadDraft } from '../../../socials/common'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: string }>(event).catch(() => null)
  const entry = (await journal()).find(e => e.id === body?.id)
  if (!entry || entry.state !== 'failed') throw bad('rien à relancer')
  const draft = await loadDraft(entry.id)
  if (!draft) throw bad('post perdu : le refaire dans le formulaire')
  const n = network(entry.network)
  if (!n.ready() || !await n.connected()) throw bad(`${n.label} : pas encore branché (onglet Info)`)

  try {
    const result = await n.publish(draft)
    const done = { ...entry, ...result, at: new Date().toISOString(), detail: result.detail, retry: undefined }
    await amend(new Map([[entry.id, done]]))
    await dropDraft(entry.id)
    return done
  } catch (e) {
    await amend(new Map([[entry.id, { detail: failure(e) }]]))
    throw e
  }
})
