/**
 * Code d'invitation pour une adresse e-mail : une nuit offerte.
 *
 * Le code ne vaut que sur un serveur qui a le même NUXT_SECRET que celui qui
 * l'a calculé. Celui du .env doit donc être celui de la production.
 *
 *   node scripts/invite-code.mjs prenom@exemple.com
 */
import { fileURLToPath } from 'node:url'
import { inviteCode, normalizeEmail } from '../server/utils/invite-code.ts'

const email = process.argv[2]
if (!email?.includes('@')) {
  console.error('Usage : node scripts/invite-code.mjs prenom@exemple.com')
  process.exit(1)
}

if (!process.env.NUXT_SECRET) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))) } catch { /* message plus bas */ }
}
const secret = (process.env.NUXT_SECRET ?? '').trim()
if (!secret) {
  console.error('NUXT_SECRET absente : ni dans l\'environnement, ni dans .env')
  process.exit(1)
}

console.log(`${normalizeEmail(email)}  ${inviteCode(email, secret)}`)
