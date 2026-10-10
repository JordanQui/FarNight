import type { TurnContext } from '~/types/scene'
import { ScriptRuntime, loadUserFixture } from '~/utils/script-runtime'

/**
 * Les données de la page de marge.
 *
 * L'accès est fermé par server/middleware/admin-guard.ts, qui rend tout /admin
 * inexistant hors développement. Pas de garde en double ici : deux règles
 * concurrentes finissent toujours par diverger.
 *
 * La taille d'entrée n'est plus déclarée : chaque prompt est RENDU depuis le
 * script, avec le dossier de démonstration, puis mesuré. Les chiffres codés en
 * dur (3 500 jetons par scène) avaient triplé sans que la page le voie.
 */

/**
 * Approximation sur du français. Aucun appel, aucun tokenizer.
 * Tient pour gpt-4o ; Claude compte un peu plus de jetons, donc la page sous-estime.
 */
const CHARS_PER_TOKEN = 4
const tokens = (...parts: string[]) => Math.round(parts.join('').length / CHARS_PER_TOKEN)

export default defineEventHandler(async () => {
  const runtime = await ScriptRuntime.load()
  const s = runtime.script
  const user = await loadUserFixture()
  const declared = new Map(s.scenes.map(sc => [sc.id, sc]))

  const scenes = s.progression.order.map((id) => {
    const scene = runtime.scene(id)
    const isEnding = scene.kind === 'ending'
    const prompt = isEnding ? scene.buildEndingPrompt(user) : scene.buildGenerationPrompt(user)
    return {
      id,
      title: scene.title,
      act: declared.get(id)?.act ?? '',
      role: isEnding ? 'ending' : id === s.progression.start_scene ? 'opening' : 'scene',
      free: declared.get(id)?.is_free === true,
      image: !scene.staticImage,
      input_tokens: tokens(scene.systemPrompt, prompt),
      max_tokens: scene.generation.max_tokens,
    }
  })

  // Un tour ne se rend qu'avec les faits d'une scène générée : on lui donne un
  // gabarit dont chaque champ a la longueur de ce que le modèle écrit d'ordinaire.
  const line = 'Une phrase de longueur moyenne, comme le modèle en écrit pour chaque champ.'
  const npcs = [0, 1, 2, 3].map(i => ({
    id: `n${i}`, name: `Karu${i}`, archetype: 'habitué',
    appearance: line, personality: line, role: line, knows: line, beyond: line,
  }))
  const context = {
    player_name: user.identity.name,
    player_agreement: 'un homme',
    place: { name: 'Le Quai', reputation: line },
    quest: { title: 'La quête', objective: line, stakes: line, artifact: "L'objet" },
    night_goal: line,
    npcs,
    key_item: { name: 'La Clé', npc_id: 'n1', informant_npc_id: 'n0' },
    has_key_item: false,
    informed_about_item: true,
    carried_ids: [],
  } as unknown as TurnContext
  const turnScene = runtime.scene(s.progression.start_scene)

  return {
    scenes,
    turn: {
      input_tokens: tokens(
        turnScene.buildTurnSystemPrompt(context, 3),
        turnScene.buildTurnUserPrompt(context, 'je lui demande ce qu’il sait', context.npcs[0]),
      ),
      max_tokens: turnScene.turn.max_tokens,
    },
    price: { amount: s.paywall.amount_cents / 100, currency: s.paywall.currency },
    pricing: s.pricing,
    limits: s.limits,
    economics: s.economics,
    models: {
      text: s.defaults.generation.model,
      image: s.defaults.art_direction.image_model,
      image_size: s.defaults.art_direction.image_size,
    },
  }
})
