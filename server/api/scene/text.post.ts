import OpenAI from 'openai'
import type { GeneratedScene, SceneTextResponse, GeneratedEnding } from '~/types/scene'
import type { UserProfile } from '~/types/user'
import { nightOf, plannedScene, type JournalEntry, type CarriedItem } from '~/utils/journal'
import { ScriptRuntime, loadUserFixture, resolveTheme } from '~/utils/script-runtime'
import { ensureFrequencyTarget } from '~/utils/frequency-text'
import { interpolate } from '~/utils/prompt-builder'
import { requireSecret } from '~/server/utils/runtime-secrets'
import {
  assertNotLocked, consumeQuota, lockOut, rememberPosition, forgetPosition, revokeAccess,
} from '~/server/utils/session-quota'
import { scriptFingerprint } from '~/server/utils/script-fingerprint'
import { requestLang } from '~/server/utils/lang'

/** JSON canonique : l'ordre des propriétés envoyé par le navigateur ne doit pas changer le tirage. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Graine stable acceptée par Chat Completions.
 *
 * Le modèle reste libre d'écrire une scène, mais deux requêtes identiques ne
 * repartent plus d'un hasard neuf. La palette possède en plus son propre
 * calcul local ; la graine stabilise les noms de couleurs et le reste du JSON.
 */
function generationSeed(value: unknown): number {
  const input = stableJson(value)
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 1
}

/**
 * Phase 1 du pipeline : le texte.
 *
 * Renvoie une scène immédiatement jouable, sans attendre l'illustration.
 * Le client enchaîne ensuite sur /api/scene/image s'il en veut une.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<{
    sceneId?: string
    /** Profil joueur. Omis en dev : on retombe sur le dossier type (game/admission.json). */
    user?: UserProfile
    /**
     * Ce que le joueur a déjà vécu. Envoyé par le client, qui le tient : le
     * serveur ne garde aucun état entre deux scènes.
     */
    journal?: JournalEntry[]
    /** Ce que le joueur porte. La scène doit pouvoir bâtir son puzzle dessus. */
    carried?: CarriedItem[]
  }>(event) ?? {}

  // La langue vient du dossier quand il est là, du cookie sinon : c'est elle
  // qui décide de tout ce que cette route fabrique, prompts compris.
  const lang = requestLang(event, body.user)
  const runtime = await ScriptRuntime.load(lang)
  // Quota de session : arrête l'abus par rechargement avant tout appel payant.
  const limits = runtime.limits
  assertNotLocked(event, limits.lock.message)
  consumeQuota(event, 'scenes', limits)

  // Le lieu vient du plan de la nuit, fixé à l'auberge et porté par le journal :
  // le script n'en connaît que la mécanique.
  const plan = nightOf(body.journal ?? [])
  const scene = runtime.scene(body.sceneId).withPlan(plannedScene(plan, body.sceneId))
  const user = body.user ?? await loadUserFixture()
  const seed = generationSeed({
    scene_id: scene.id,
    user,
    journal: body.journal ?? [],
    carried: body.carried ?? [],
  })

  /**
   * Retient la scène servie, pour que le joueur puisse y revenir.
   *
   * Ici et nulle part ailleurs : c'est le seul endroit où le serveur constate
   * qu'une scène a bien été rendue. La reprise ne doit désigner que des scènes
   * réellement traversées — sinon le bouton « Continuer » enverrait construire
   * une scène dont la précédente n'a jamais eu lieu.
   */
  const remember = (gameOver?: string) => rememberPosition(
    event, scene.id, runtime.script.progression.order.indexOf(scene.id),
    limits.paid.window_days,
    // Le texte de fermeture PART AVEC LA POSITION : quand la nuit se refermera,
    // le serveur n'aura plus que ce cookie pour savoir quoi afficher, et le
    // client n'aura plus la scène s'il a rechargé entre-temps.
    gameOver,
  )

  const openai = new OpenAI({ apiKey: requireSecret(config.openaiApiKey, 'OPENAI_API_KEY') })
  const gen = scene.generation

  // L'épilogue ne suit pas le schéma des autres scènes : ni personnages, ni
  // quête, ni objet-clé. Il rend un texte, une palette d'aube et de quoi
  // peupler l'image de ce que ce joueur-là a traversé.
  const isEnding = scene.kind === 'ending'

  /** Les deux messages de la demande. La reprise repart de là. */
  type Message = { role: 'system' | 'user' | 'assistant'; content: string }
  const messages: Message[] = [
    // `scene.systemPrompt` et non `gen.system_prompt` : c'est lui qui remplit
    // le {{language}} du script et qui y colle la directive de sortie.
    { role: 'system', content: scene.systemPrompt },
    {
      role: 'user',
      content: isEnding
        ? scene.buildEndingPrompt(user, body.journal ?? [], body.carried ?? [])
        : scene.buildGenerationPrompt(user, body.journal ?? [], body.carried ?? []),
    },
  ]

  /** Un appel au modèle, et le JSON brut qu'il rend. */
  async function ask(msgs: Message[]): Promise<string> {
    let completion
    try {
      completion = await openai.chat.completions.create({
        model: gen.model,
        temperature: gen.temperature,
        seed,
        max_tokens: gen.max_tokens,
        response_format: { type: 'json_object' },
        messages: msgs,
      })
    } catch (err) {
      throw createError({
        statusCode: 502,
        statusMessage: err instanceof Error ? err.message : `Appel à ${gen.model} échoué`,
      })
    }

    const choice = completion.choices[0]
    const raw = choice?.message?.content
    if (!raw) {
      throw createError({ statusCode: 502, statusMessage: `${gen.model} n'a rien renvoyé` })
    }

    // Coupé au plafond : le JSON s'arrête au milieu d'une chaîne et `JSON.parse`
    // échoue plus bas, sur un message qui accuse le modèle à tort. On le dit ici,
    // pendant qu'on sait encore pourquoi — c'est `max_tokens` qu'il faut lever,
    // ou le schéma qu'il faut alléger.
    if (choice.finish_reason === 'length') {
      console.error(
        `[scene/text] réponse tronquée à max_tokens=${gen.max_tokens}`,
        `(${completion.usage?.completion_tokens ?? '?'} tokens produits)`)
      throw createError({
        statusCode: 502,
        statusMessage: `Réponse tronquée : la scène dépasse le plafond de ${gen.max_tokens} tokens`,
      })
    }

    return raw
  }

  function parseScene(raw: string): GeneratedScene {
    try {
      return JSON.parse(raw) as GeneratedScene
    } catch {
      // Les 300 derniers caractères disent où ça s'est arrêté — sans eux, on ne
      // peut pas distinguer une coupure d'un modèle qui bavarde hors JSON.
      console.error('[scene/text] JSON invalide, fin de la réponse :', raw.slice(-300))
      throw createError({ statusCode: 502, statusMessage: `${gen.model} a renvoyé un JSON invalide` })
    }
  }

  const raw = await ask(messages)
  let generated = parseScene(raw)

  if (isEnding) {
    try {
      const journal = body.journal ?? []
      const ending = generated as unknown as GeneratedEnding
      const assembled = {
        ...scene.assembleEnding(ending, journal[journal.length - 1]?.place_name ?? ''),
        script_fingerprint: scriptFingerprint(runtime.script),
      }

      // L'histoire est traversée : la ville se ferme, et pour de bon. Ce monde
      // a été bâti pour ce joueur-là et il ne se rejoue pas — c'est ce que
      // promet le paywall, et c'est aussi ce qui rend la fenêtre payante
      // tenable. L'adieu part dans le cookie : il doit survivre au
      // rechargement, l'épilogue ne s'affiche qu'une fois.
      lockOut(event, limits.lock.completed_days * 24, 'completed', ending.farewell)
      // Plus rien à reprendre : sans cet oubli, l'accueil proposerait de
      // « continuer » vers un épilogue déjà lu, que le verrou refuserait.
      forgetPosition(event)
      // La nuit achetée est jouée : rejouer demande un nouveau paiement.
      revokeAccess(event)

      return assembled
    } catch (err) {
      console.error('[scene/text] épilogue invalide :', err instanceof Error ? err.message : err)
      throw createError({
        statusCode: 502,
        statusMessage: err instanceof Error ? err.message : 'Fin invalide',
      })
    }
  }

  /**
   * Une scène refusée par la validation vaut UNE reprise, et une seule.
   *
   * Le modèle manque parfois une contrainte — le plus souvent un personnage
   * qu'il déclare dans `npcs` sans jamais le nommer dans le texte, ce qui le
   * rend inatteignable. Jusqu'ici la scène partait en 502 : le joueur venait de
   * remplir son dossier d'admission et tombait sur une panne, avec son quota
   * déjà consommé.
   *
   * On lui renvoie donc sa propre réponse et le motif du refus, plutôt que de
   * relancer une génération à l'aveugle : il corrige le point visé et garde le
   * reste. Le coût d'une reprise est celui d'une génération — de l'ordre de
   * trois centimes — et il n'est payé que sur un échec.
   */
  scene.dropUnreachable(generated)
  scene.ensurePuzzleObjects(generated)
  scene.weldAugmentationName(generated)
  if (scene.id === 'a1s2') ensureFrequencyTarget(generated)
  scene.pinPlayerPalette(generated, user)

  try {
    scene.assertValid(generated)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[scene/text] scène refusée, une reprise demandée :', reason)

    const repaired = await ask([
      ...messages,
      { role: 'assistant', content: raw },
      { role: 'user', content: interpolate(gen.repair_prompt, { reason }) },
    ])
    generated = parseScene(repaired)
    scene.dropUnreachable(generated)
    scene.ensurePuzzleObjects(generated)
    scene.weldAugmentationName(generated)
    if (scene.id === 'a1s2') ensureFrequencyTarget(generated)
    scene.pinPlayerPalette(generated, user)

    try {
      scene.assertValid(generated)
    } catch (again) {
      console.error('[scene/text] scène invalide après reprise :',
        again instanceof Error ? again.message : again)
      throw createError({
        statusCode: 502,
        statusMessage: again instanceof Error ? again.message : 'Scène invalide',
      })
    }
  }

  const assembled = {
    ...scene.assembleText(generated, resolveTheme(user, runtime.script), body.carried ?? [], body.journal ?? []),
    // La quête voyage avec chaque scène : c'est de là que le journal la reprend.
    night: generated.night ?? plan,
    // Permet au client de jeter une scène gardée en session dès que le script
    // a changé — sans quoi un déploiement reste invisible pour lui.
    script_fingerprint: scriptFingerprint(runtime.script),
  }
  remember(assembled.game_over)
  return assembled
})
