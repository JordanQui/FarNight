import OpenAI from 'openai'
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

  const openai = new OpenAI({ apiKey: requireSecret(config.openaiApiKey, 'OPENAI_API_KEY') })

  /**
   * Un refus d'OpenAI ne doit pas ressortir avec SON statut.
   *
   * h3 recopie le `status` de l'erreur : un 429 d'OpenAI devenait un 429 du
   * jeu, que le joueur lisait « Le serveur a répondu 429 » — et qui se
   * confond avec le quota de session, lui aussi en 429. Le SDK a déjà
   * réessayé deux fois avant d'abandonner : arrivé ici, ce n'est plus un
   * à-coup. `insufficient_quota` veut dire que le crédit du compte est épuisé,
   * le reste est une limite de débit ; on le dit dans les journaux, et le
   * client n'affiche qu'un narrateur indisponible.
   */
  let stream
  try {
    stream = await openai.chat.completions.create({
      model: scene.generation.model,
      temperature: scene.generation.temperature,
      max_tokens: scene.turn.max_tokens,
      stream: true,
      // Sans ça le décompte serait une estimation : on veut les vrais chiffres.
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: scene.buildTurnSystemPrompt(body.context, body.turnCount ?? 0) },
        ...buildConversationHistory(body.history ?? []),
        { role: 'user', content: scene.buildTurnUserPrompt(body.context, body.input, npc, body.mode) },
      ],
    })
  } catch (err) {
    const status = err instanceof OpenAI.APIError ? err.status : undefined
    const code = err instanceof OpenAI.APIError ? err.code : undefined
    console.error(
      `[narrative/turn] ${scene.generation.model} a refusé le tour`,
      `(${status ?? '?'}${code ? ` ${code}` : ''}) :`,
      err instanceof Error ? err.message : err)
    throw createError({
      statusCode: 503,
      statusMessage: code === 'insufficient_quota'
        ? 'Crédit OpenAI épuisé'
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
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) send({ text: delta })

          // OpenAI place l'usage dans un dernier chunk, sans contenu.
          if (chunk.usage) {
            send({
              usage: {
                prompt_tokens: chunk.usage.prompt_tokens,
                completion_tokens: chunk.usage.completion_tokens,
              },
            })
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
