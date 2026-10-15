/**
 * L'ouverture de la séance du moniteur : GET la lit, POST la remet à
 * maintenant. Gardée dans le stockage local comme le solde OpenAI ; sans
 * remise à zéro, la page retombe sur sa constante SINCE.
 */
const SINCE_KEY = 'monitor:since'

export default defineEventHandler(async (event) => {
  const storage = useStorage('data')
  if (event.method === 'POST') {
    const since = new Date().toISOString()
    await storage.setItem(SINCE_KEY, since)
    return { since }
  }
  return { since: await storage.getItem<string>(SINCE_KEY) }
})
