import Anthropic from '@anthropic-ai/sdk'
import type { TurnRequest } from '~/types/scene'
import { ScriptRuntime } from '~/utils/script-runtime'
import { clampPlanned } from '~/utils/journal'
import { buildConversationHistory } from '~/utils/prompt-builder'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { assertNotLocked, consumeQuota } from '~/server/utils/session-quota'
import { requestLang } from '~/server/utils/lang'
import { resolveLang } from '~/utils/languages'

/**
 * Un tour de jeu, en streaming SSE.
 *
 * Le prompt système est reconstruit ici depuis le script : le client fournit
 * les faits de sa scène (lieu, quête, PNJ), jamais d'instruction au modèle.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<TurnRequest>(event)

  if (!body?.input || !body?.context?.place || !body?.context?.quest) {
    throw createError({ statusCode: 400, statusMessage: 'Champs requis : input, context.place, context.quest' })
  }

  // Le tour n'envoie pas de profil : la langue vient du corps quand le client
  // la joint, du cookie sinon. Les deux disent la même chose — le client écrit
  // le cookie au moment où le joueur choisit.
  const lang = body.lang ? resolveLang(body.lang) : requestLang(event)
  const runtime = await ScriptRuntime.load(lang)
  // Quota de session : arrête l'abus par rechargement avant tout appel payant.
  const limits = runtime.limits
  assertNotLocked(event, limits.lock.message)
  consumeQuota(event, 'turns', limits)

  // La sortie et l'exigence du lieu viennent du plan, que le client renvoie.
  const scene = runtime.scene(body.sceneId).withPlan(clampPlanned(body.context.planned))

  const npc = body.npcId && body.mode !== 'exit_nudge'
    ? body.context.npcs?.find(n => n.id === body.npcId)
    : undefined

  const claude = new Anthropic({ apiKey: requireSecret(config.anthropicApiKey, 'ANTHROPIC_API_KEY') })

  // Claude exige que l'échange commence par le joueur : une réplique de PNJ
  // restée en tête du fil, une fois l'historique borné, ferait refuser le tour.
  const history = buildConversationHistory(body.history ?? [])
  while (history[0]?.role === 'assistant') history.shift()

  /**
   * Un refus de l'API ne doit pas ressortir avec SON statut.
   *
   * h3 recopie le `status` de l'erreur : un 429 de l'API devenait un 429 du
   * jeu, que le joueur lisait « Le serveur a répondu 429 » — et qui se
   * confond avec le quota de session, lui aussi en 429. Le SDK a déjà
   * réessayé deux fois avant d'abandonner : arrivé ici, ce n'est plus un
   * à-coup. Un crédit épuisé arrive en 400 avec « credit balance » dans le
   * message ; on le dit dans les journaux, et le client n'affiche qu'un
   * narrateur indisponible.
   */
  let stream
  try {
    // `create` et non `stream` : il attend la réponse de l'API, si bien qu'un
    // refus lève ici, avant que les en-têtes SSE ne partent.
    stream = await claude.messages.create({
      model: scene.generation.model,
      max_tokens: scene.turn.max_tokens,
      // Pas de raisonnement : il retarderait la première phrase et se facture.
      thinking: { type: 'between_tools' },
      stream: true,
      system: scene.buildTurnSystemPrompt(body.context, body.turnCount ?? 0),
      messages: [
        ...history,
        { role: 'user', content: scene.buildTurnUserPrompt(body.context, body.input, npc, body.mode) },
      ],
    })
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined
    const noCredit = err instanceof Error && /credit balance/i.test(err.message)
    console.error(
      `[narrative/turn] ${scene.generation.model} a refusé le tour`,
      `(${status ?? '?'}) :`,
      err instanceof Error ? err.message : err)
    throw createError({
      statusCode: 503,
      statusMessage: noCredit
        ? 'Crédit Claude épuisé'
        : `Appel à ${scene.generation.model} refusé (${status ?? 'réseau'})`,
      data: { reason: 'narrator_unavailable' },
    })
  }

  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const encoder = new TextEncoder()

  // h3 attend un vrai stream : lui passer une fonction lève « Invalid stream provided ».
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

      try {
        // L'entrée arrive avec `message_start`, la sortie avec `message_delta` :
        // on les réunit pour envoyer le décompte sous les noms que le client lit.
        let promptTokens = 0
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ text: chunk.delta.text })
          } else if (chunk.type === 'message_start') {
            const u = chunk.message.usage
            promptTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          } else if (chunk.type === 'message_delta') {
            send({ usage: { prompt_tokens: promptTokens, completion_tokens: chunk.usage.output_tokens } })
          }
        }
      } catch {
        send({ text: scene.fallbacks.narrative_error })
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return sendStream(event, sse)
})
