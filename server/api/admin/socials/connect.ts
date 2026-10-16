/**
 * Brancher un compte par OAuth. GET `?network=` rend l'adresse d'autorisation
 * (le `state` garde le réseau, l'adresse de retour et le vérificateur PKCE une
 * heure) ; POST échange le code, reçu tel quel ou dans l'adresse de retour
 * collée depuis la barre du navigateur.
 */
import { network } from '../../../socials'
import { bad, takeState } from '../../../socials/common'

export default defineEventHandler(async (event) => {
  if (event.method === 'GET') {
    const n = network(getQuery(event).network)
    if (!n.authorize) throw bad(`${n.label} se branche par le .env, pas par une autorisation`)
    if (!n.ready()) throw bad(`${n.label} : identifiants de l’app manquants au .env`)
    return { url: await n.authorize(getRequestURL(event).port || '3000') }
  }

  const body = await readBody<{ url?: string; code?: string; state?: string }>(event).catch(() => null)
  let code = body?.code?.trim()
  let state = body?.state?.trim()
  if (body?.url) {
    let u: URL
    try {
      u = new URL(body.url.trim())
    } catch {
      throw bad('adresse illisible : coller toute l’adresse de la barre')
    }
    code = u.searchParams.get('code') ?? code
    state = u.searchParams.get('state') ?? state
    const refused = u.searchParams.get('error_description') ?? u.searchParams.get('error')
    if (refused && !code) throw bad(`autorisation refusée : ${refused}`)
  }
  if (!code || !state) throw bad('code ou state absent de l’adresse')
  const pending = await takeState(state)
  if (!pending) throw bad('autorisation expirée ou déjà utilisée : relancer « Brancher »')
  const n = network(pending.network)
  await n.connect!(code, pending)
  return { network: n.id }
})
