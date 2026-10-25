import upstashDriver from 'unstorage/drivers/upstash'

/**
 * Le stockage `data` des pages d'admin (jetons des réseaux, journal, groupes de
 * cibles, remise à zéro du monitor, crédit OpenAI) passe sur Upstash Redis dès
 * que ses clés sont là.
 *
 * Sur Vercel, le `.data/kv` par défaut de Nitro n'est pas inscriptible et ne
 * survit pas d'une fonction à l'autre. Les mêmes clés au .env local font
 * partager au poste et à la prod les mêmes jetons : X et YouTube ne se
 * branchent qu'en local (adresses de retour), et X renouvelle son jeton à
 * chaque usage, donc deux copies finiraient par se périmer l'une l'autre.
 *
 * Lu à l'exécution, pas au build (voir server/utils/runtime-secrets.ts).
 * Noms de l'intégration Upstash du Marketplace Vercel, ou ceux d'Upstash.
 */
export default defineNitroPlugin(() => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return

  const storage = useStorage()
  // Sans dispose, le démontage est synchrone : le montage suit sans attendre.
  void storage.unmount('data', false)
  storage.mount('data', upstashDriver({ url, token, base: 'farnight' }))
})
