import Anthropic from '@anthropic-ai/sdk'
import type { GeneratedScene, SceneTextResponse, GeneratedEnding } from '~/types/scene'
import type { UserProfile } from '~/types/user'
import { nightOf, plannedScene, type JournalEntry, type CarriedItem } from '~/utils/journal'
import { ScriptRuntime, loadUserFixture, resolveTheme } from '~/utils/script-runtime'
import { ensureFrequencyTarget } from '~/utils/frequency-text'
import { interpolate } from '~/utils/prompt-builder'
import { requireSecret } from '~/server/utils/runtime-secrets'
import {
  assertNotLocked, consumeQuota, lockOut, positionTicket, forgetPosition, revokeAccess,
} from '~/server/utils/session-quota'
import { scriptFingerprint } from '~/server/utils/script-fingerprint'
import { requestLang } from '~/server/utils/lang'
import { isLocal } from '~/utils/app-env'

/**
 * Le JSON seul, sans l'habillage qu'un modèle ajoute parfois.
 *
 * Claude n'a pas de `response_format: json_object` : le prompt demande le JSON
 * nu, mais une clôture ```json ou une phrase d'introduction passent encore.
 * On garde ce qui va de la première accolade à la dernière.
 */
function bareJson(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw
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
  // Sans dossier, pas de nuit : le dossier type ne sert qu'en local, aux
  // commandes `#scene<n>` lancées sans être passé par le formulaire.
  if (!body.user?.identity?.name && !isLocal()) {
    throw createError({ statusCode: 400, statusMessage: 'Dossier manquant' })
  }
  const user = body.user ?? await loadUserFixture()

  /**
   * Scelle la scène servie, pour que le joueur puisse y revenir.
   *
   * Ici et nulle part ailleurs : c'est le seul endroit où le serveur constate
   * qu'une scène a bien été rendue. La reprise ne doit désigner que des scènes
   * réellement traversées — sinon le bouton « Continuer » enverrait construire
   * une scène dont la précédente n'a jamais eu lieu.
   */
  const ticket = (gameOver?: string) => positionTicket(
    scene.id, runtime.script.progression.order.indexOf(scene.id),
    // Le texte de fermeture PART AVEC LA POSITION : quand la nuit se refermera,
    // le serveur n'aura plus que ce cookie pour savoir quoi afficher, et le
    // client n'aura plus la scène s'il a rechargé entre-temps.
    gameOver,
  )

  const claude = new Anthropic({ apiKey: requireSecret(config.anthropicApiKey, 'ANTHROPIC_API_KEY') })
  const gen = scene.generation

  // L'épilogue ne suit pas le schéma des autres scènes : ni personnages, ni
  // quête, ni objet-clé. Il rend un texte, une palette d'aube et de quoi
  // peupler l'image de ce que ce joueur-là a traversé.
  const isEnding = scene.kind === 'ending'

  /** La demande. La reprise repart de là ; le prompt système voyage à part. */
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: isEnding
        ? scene.buildEndingPrompt(user, body.journal ?? [], body.carried ?? [])
        : scene.buildGenerationPrompt(user, body.journal ?? [], body.carried ?? []),
    },
  ]

  /** Un appel au modèle, et le JSON brut qu'il rend. */
  async function ask(msgs: Anthropic.MessageParam[], waits = 2): Promise<string> {
    let completion
    try {
      // En flux, puis réassemblé : une scène entière se compte en minutes, et
      // une requête qui ne renvoie rien aussi longtemps se fait couper en route.
      completion = await claude.messages.stream({
        model: gen.model,
        max_tokens: gen.max_tokens,
        // Pas de raisonnement : il se facture comme de la sortie, et une scène
        // est une commande d'écriture, pas un problème à résoudre.
        thinking: { type: 'between_tools' },
        // `scene.systemPrompt` et non `gen.system_prompt` : c'est lui qui remplit
        // le {{language}} du script et qui y colle la directive de sortie.
        system: scene.systemPrompt,
        messages: msgs,
      }).finalMessage()
    } catch (err) {
      // Limite de débit par minute : une scène pèse lourd dans le plafond du
      // palier, et l'API dit combien attendre — souvent plus que les deux
      // reprises du SDK. On attend ce délai, borné, puis on relance.
      if (err instanceof Anthropic.RateLimitError && waits > 0) {
        const s = Number(err.headers?.get('retry-after'))
        const ms = Number.isFinite(s) && s > 0 ? s * 1000 : 15000
        console.warn(`[scene/text] limite de débit ${gen.model}, nouvel essai dans ${Math.ceil(ms / 1000)} s`)
        await new Promise(resolve => setTimeout(resolve, Math.min(ms + 500, 30000)))
        return ask(msgs, waits - 1)
      }
      // « Connection error. » ne dit rien : la vraie cause est dans `cause`.
      if (err instanceof Anthropic.APIConnectionError) {
        console.error('[scene/text] Claude injoignable :', err.cause ?? err)
      }
      throw createError({
        statusCode: 502,
        statusMessage: err instanceof Error ? err.message : `Appel à ${gen.model} échoué`,
      })
    }

    const raw = completion.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    if (completion.stop_reason === 'refusal') {
      console.error('[scene/text] refus du modèle :', completion.stop_details)
      throw createError({ statusCode: 502, statusMessage: `${gen.model} a refusé la scène` })
    }
    if (!raw) {
      throw createError({ statusCode: 502, statusMessage: `${gen.model} n'a rien renvoyé` })
    }

    // Coupé au plafond : le JSON s'arrête au milieu d'une chaîne et `JSON.parse`
    // échoue plus bas, sur un message qui accuse le modèle à tort. On le dit ici,
    // pendant qu'on sait encore pourquoi — c'est `max_tokens` qu'il faut lever,
    // ou le schéma qu'il faut alléger.
    if (completion.stop_reason === 'max_tokens') {
      console.error(
        `[scene/text] réponse tronquée à max_tokens=${gen.max_tokens}`,
        `(${completion.usage.output_tokens} tokens produits)`)
      throw createError({
        statusCode: 502,
        statusMessage: `Réponse tronquée : la scène dépasse le plafond de ${gen.max_tokens} tokens`,
      })
    }

    return bareJson(raw)
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

  // L'épilogue répond d'un bloc : il est court, et il pose ses cookies — le
  // verrou, l'oubli de la position, la fin de l'accès — qu'un flux déjà
  // ouvert ne pourrait plus envoyer.
  if (isEnding) {
    const ending = parseScene(await ask(messages)) as unknown as GeneratedEnding
    try {
      const journal = body.journal ?? []
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

  return streamScene(event, async () => {
    const raw = await ask(messages)
    let generated = parseScene(raw)

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
    scene.bindOffering(generated)
    scene.alignPlanIds(generated)
    scene.weldAugmentationName(generated)
    if (scene.id === 'a1s2' || scene.id === 'a3s2') ensureFrequencyTarget(generated)
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
      scene.bindOffering(generated)
      scene.alignPlanIds(generated)
      scene.weldAugmentationName(generated)
      if (scene.id === 'a1s2' || scene.id === 'a3s2') ensureFrequencyTarget(generated)
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
    return { scene: assembled, ticket: ticket(assembled.game_over) }
  })
})

/**
 * Répond en NDJSON pendant que la scène s'écrit.
 *
 * Une scène prend plusieurs minutes, reprise comprise. Une requête muette aussi
 * longtemps se fait couper — Safari n'en dit que « Load failed », et l'erreur
 * du serveur n'arrive jamais. Un battement toutes les dix secondes garde la
 * connexion vivante ; la dernière ligne porte la scène, ou l'erreur avec ses
 * `statusCode`, `statusMessage` et `data`, comme une réponse en erreur.
 *
 * Les en-têtes partent avec le premier battement : ce qui doit poser un cookie
 * passe avant, ou voyage dans la scène (la position, en ticket).
 */
function streamScene(
  event: H3Event,
  build: () => Promise<{ scene: SceneTextResponse, ticket: string }>,
) {
  setResponseHeader(event, 'Content-Type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      send({ t: 'wait' })
      const beat = setInterval(() => send({ t: 'wait' }), 10_000)
      try {
        send({ t: 'scene', ...await build() })
      } catch (err) {
        const e = err as { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }
        send({
          t: 'error',
          statusCode: e.statusCode ?? 500,
          statusMessage: e.statusMessage ?? e.message ?? 'Scène impossible',
          data: e.data,
        })
      } finally {
        clearInterval(beat)
        controller.close()
      }
    },
  })
  return sendStream(event, body)
}
