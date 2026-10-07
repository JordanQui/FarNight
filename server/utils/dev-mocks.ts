import { createHash } from 'node:crypto'
import { isLocal } from '~/utils/app-env'
export { scriptFingerprint } from '~/server/utils/script-fingerprint'

/**
 * Enregistrement et rejeu des générations, en local uniquement.
 *
 * Une scène coûte ~2,6 centimes, son image ~6,5. Sur une journée de mise au
 * point où l'on relance l'expérience trente fois, on paie trente fois la même
 * chose. Ici, la première génération est écrite sur disque et les suivantes la
 * rejouent : gratuit, et instantané.
 *
 * Tout est conditionné à `APP_ENV=local`. En production ces fonctions sont
 * inertes et n'écrivent jamais rien — Vercel a de toute façon un système de
 * fichiers en lecture seule.
 *
 * DÉSACTIVÉ PAR DÉFAUT. Un mock enregistré avant une modification des prompts
 * rejoue l'ancienne version de la scène : on croit tester ses changements alors
 * qu'on relit du passé, et le jeu paraît cassé sans raison. Pour les activer :
 * `DEV_MOCKS=1` dans le .env.
 *
 * Même activés, ils sont invalidés dès que `game/script.json` change — leur
 * empreinte inclut celle du script. Toute modification de prompt reconstruit
 * donc les mocks à la session suivante, automatiquement.
 *
 * Pour forcer une régénération sans rien désactiver : `?fresh=1`.
 */

const DIR = '.mocks'

/** Les mocks n'existent qu'en local, et seulement si on les demande. */
function enabled(): boolean {
  return isLocal() && process.env.DEV_MOCKS === '1'
}

/** Une empreinte par scène et par joueur : deux profils, deux mocks. */
export function mockKey(sceneId: string, seed: string, fingerprint: string): string {
  return createHash('sha256').update(`${fingerprint}|${sceneId}|${seed}`).digest('hex').slice(0, 16)
}

async function fsModule() {
  // Import dynamique : le module n'est jamais chargé hors développement.
  const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')])
  return { fs, path }
}

function filePath(pathMod: typeof import('node:path'), kind: string, key: string): string {
  return pathMod.resolve(process.cwd(), DIR, `${kind}-${key}.json`)
}

export async function readMock<T>(kind: string, key: string): Promise<T | null> {
  if (!enabled()) return null

  try {
    const { fs, path } = await fsModule()
    const raw = await fs.readFile(filePath(path, kind, key), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    // Absent ou illisible : on régénère, c'est le comportement attendu.
    return null
  }
}

export async function writeMock(kind: string, key: string, value: unknown): Promise<void> {
  if (!enabled()) return

  try {
    const { fs, path } = await fsModule()
    await fs.mkdir(path.resolve(process.cwd(), DIR), { recursive: true })
    await fs.writeFile(filePath(path, kind, key), JSON.stringify(value, null, 2), 'utf-8')
  } catch {
    // Un mock qu'on ne peut pas écrire ne doit jamais faire échouer un tour.
  }
}

/** `?fresh=1` force une vraie génération et réécrit le mock. */
export function wantsFresh(event: H3Event): boolean {
  const q = getQuery(event)
  return q.fresh === '1' || q.fresh === 'true'
}
