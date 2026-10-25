import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * La CLI `vercel` de ce poste, pour la page de suivi de la prod.
 *
 * Elle est déjà connectée et sait ce que l'API REST publique ne donne pas :
 * journaux historiques, métriques, facturation. Aucun jeton à recopier dans le
 * .env. Elle n'existe pas en prod : là, server/utils/vercel-api.ts appelle
 * les mêmes routes avec un jeton.
 *
 * Le projet et l'équipe sont ceux de .vercel/project.json, posés par `vercel link`.
 */

const run = promisify(execFile)

/** Une commande restée sans réponse : pour `logs`, ça veut souvent dire « rien trouvé ». */
export class VercelTimeout extends Error {}

export async function vercelProject(): Promise<{ projectId: string; orgId: string; projectName: string }> {
  return JSON.parse(await readFile(join(process.cwd(), '.vercel/project.json'), 'utf8'))
}

/** Lance `vercel <args>` sur l'équipe du projet et rend sa sortie standard. */
export async function vercelCli(args: string[], timeoutMs = 30_000): Promise<string> {
  const { orgId } = await vercelProject()
  try {
    const { stdout } = await run('vercel', [...args, `--scope=${orgId}`, '--no-color', '--non-interactive'], {
      cwd: process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    })
    return stdout
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string }
    if (err.code === 'ENOENT') throw new Error('la CLI vercel est introuvable sur ce poste')
    if (err.killed) throw new VercelTimeout(`vercel ${args[0]} : pas de réponse en ${timeoutMs / 1000} s`)
    // En --json, la CLI écrit son erreur en JSON sur la sortie standard.
    const json = err.stdout?.slice(err.stdout.search(/[[{]/))
    const reason = (() => { try { return JSON.parse(json ?? '').error?.message } catch { return null } })()
    throw new Error(`vercel ${args[0]} : ${reason ?? err.stderr?.trim().split('\n').pop() ?? err.message}`)
  }
}

/** Le JSON d'une commande `--json` ou `api` : la CLI peut écrire une ligne d'état avant lui. */
export async function vercelJson<T>(args: string[], timeoutMs?: number): Promise<T> {
  const out = await vercelCli(args, timeoutMs)
  const data = JSON.parse(out.slice(out.search(/[[{]/)))
  if (data?.error) throw new Error(`vercel ${args[0]} : ${data.error.message ?? data.error.code}`)
  return data
}
