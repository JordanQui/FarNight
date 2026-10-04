import type { Qualities, StoryletEffect } from '~/utils/storylets'
import { draw } from '~/utils/storylets'
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useNarrative } from '~/composables/useNarrative'
import { usePaywall } from '~/composables/usePaywall'
import { useSceneCommands } from '~/composables/useSceneCommands'
import { resolveLocally, buildGuidance, lookedThing } from '~/utils/scene-oracle'
import { translate } from '~/utils/languages'
import { takeTarget, observationOf } from '~/utils/interactables'
import { usePuzzle } from '~/composables/usePuzzle'
import type { Interactable } from '~/types/scene'

/**
 * Le seul chemin par lequel une saisie entre dans le jeu.
 *
 * Deux responsabilités, et pas une de plus : décanter l'état du monde en
 * qualités — ce que fait `snapshot()` —, puis exécuter le moment que le deck a
 * tiré. Aucune priorité ne se décide ici : elle est dans `utils/storylets.ts`,
 * en clair, dans l'ordre du tableau.
 *
 * Le lexique du monde reste dans script.json : les mots de la sortie, les
 * seuils de relance et de dénouement sont lus sur la scène, jamais écrits ici.
 */
export function useStorylets() {
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const { runTurn, interlocutor, addressesNobody, answerLocally, mentionsExit } = useNarrative()
  const { openExit } = usePaywall()
  const { isCommand, run: runSceneCommand } = useSceneCommands()
  const puzzle = usePuzzle()

  /**
   * La chose du décor que cette saisie réclame, si elle en réclame une.
   *
   * Résolue deux fois — une fois pour la qualité, une fois pour l'exécuter —
   * parce que le deck ne doit connaître que des booléens : il se teste sans
   * Vue, sans Pinia et sans scène, et une chose de la scène n'y entrerait pas.
   * Le calcul est un filtre sur une poignée d'objets, il ne coûte rien.
   */
  function claimed(input: string) {
    const scene = playerStore.scene
    if (!scene) return null
    const obj = takeTarget(
      input, scene.interactables, playerStore.language, gameStore.revealedInteractableIds)
    // Déjà dans sa poche : ce n'est plus un ramassage, et le tour ordinaire
    // dira mieux que nous qu'il l'a sur lui.
    if (!obj || gameStore.inventory.some(o => o.id === obj.id)) return null
    return obj
  }

  /** Ce que l'oracle et le récapitulatif ont besoin de savoir du joueur. */
  function oracleState() {
    return {
      hasKeyItem: gameStore.hasKeyItem,
      talkedToNpcIds: gameStore.talkedToNpcIds,
      // Ce qu'il porte déjà : le récapitulatif ne lui signale un objet posé
      // dans la salle que tant qu'il ne l'a pas ramassé.
      carriedIds: gameStore.inventory.map(o => o.id),
      revealedIds: gameStore.revealedInteractableIds,
      lookedLabels: gameStore.lookedLabels,
    }
  }

  /**
   * L'état du monde, aplati.
   *
   * Tout ce qui relève du texte — mots de la sortie, personnage interpellé,
   * réponse déjà écrite — est résolu ICI, une fois, et n'existe plus ensuite
   * que sous forme de booléens. C'est ce qui permet au deck de n'avoir aucune
   * dépendance et de se tester seul.
   */
  function snapshot(input: string): Qualities {
    const scene = playerStore.scene
    const item = scene?.key_item ?? null
    const pacing = scene?.pacing
    // Celui à qui la saisie s'adresse : nommé à l'instant, ou déjà en face de
    // lui depuis le tour d'avant. Le deck n'a jamais à savoir lequel des deux.
    const npc = scene ? interlocutor(input) : undefined

    const claim = claimed(input)

    // Le don ne se lit pas dans la phrase : il vient du clic sur « Donner »,
    // qui a déjà désigné l'objet ET le destinataire. La saisie ne sert qu'à
    // laisser une trace au fil.
    const give = gameStore.pendingGive
    const wanted = give
      ? playerStore.npcs.find(n => n.id === give.npcId)?.wants?.item_id === give.itemId
      : false

    // Les deux plafonds : le compte de tours mord en pratique, le budget en
    // dollars n'est qu'un filet si les prompts venaient à grossir.
    const capReached = (pacing?.hard_turn_cap ?? 0) > 0
      && gameStore.modelTurnsUsed >= pacing!.hard_turn_cap
    const budgetReached = (pacing?.budget_usd ?? 0) > 0
      && gameStore.spentUsd >= pacing!.budget_usd

    return {
      isCommand: isCommand(input),

      turn: gameStore.turnCount,

      // Les mots-clés viennent de la scène servie, donc du pack de langue :
      // le client et le serveur testent la MÊME liste. En conversation, une
      // liste plus étroite : voir `mentionsExit`.
      mentionsExit: mentionsExit(input),
      exitOpensAtTurn: scene?.paywall.min_turns_before_trigger ?? 0,

      addressesNobody: scene ? addressesNobody(input) : false,
      talksToNpc: Boolean(npc),
      addressesHolder: Boolean(npc && item && npc.id === item.npc_id),

      sceneHasKeyItem: Boolean(item),
      hasKeyItem: gameStore.hasKeyItem,
      pendingKeyItem: gameStore.pendingKeyItem,
      informed: gameStore.informedAboutItem,
      holderExchanges: gameStore.keyItemExchanges + 1,
      exchangesBeforeHandover: item?.exchanges_before_handover ?? 0,

      failureAtTurn: pacing?.failure_after_turns ?? 0,

      takesReadableObject: Boolean(claim) && gameStore.decryptedObjectIds.includes(claim!.id),
      takesUnreadObject: Boolean(claim) && !gameStore.decryptedObjectIds.includes(claim!.id),

      searchesSpot: Boolean(scene) && Boolean(puzzle.spotOf(input)),

      offersItem: Boolean(give),
      offersWantedItem: Boolean(give) && wanted,

      localAnswer: scene ? resolveLocally(input, scene, oracleState(), playerStore.language) : null,
      canCallModel: !capReached && !budgetReached,
    }
  }

  /** Le texte d'une réponse qui ne passe pas par le modèle. */
  function localText(
    say: 'oracle' | 'nobody' | 'unused_lens' | 'unread_object' | 'exhausted' | 'blocked_exit',
    q: Qualities,
  ): string {
    const scene = playerStore.scene
    const lang = playerStore.language
    const t = (key: string, vars?: Record<string, string>) => translate(lang, key, vars)

    if (say === 'oracle') return q.localAnswer?.text ?? ''
    if (say === 'nobody') return t('oracle.no_name')
    if (say === 'unread_object') return t('oracle.unread_object')
    // Deux tournures, en alternance : la même phrase deux fois de suite se lit
    // comme un message d'erreur.
    if (say === 'blocked_exit') {
      return t(q.turn % 2 ? 'oracle.exit_blocked_2' : 'oracle.exit_blocked', {
        exit: scene?.exit_label ?? '',
      })
    }
    if (say === 'unused_lens') {
      return t('oracle.unused_lens', {
        tool: scene?.key_item?.name ?? t('oracle.unused_lens_tool'),
      })
    }
    const notice = scene?.pacing?.autonomous_notice ?? ''
    return scene ? `${notice}\n\n${buildGuidance(scene, oracleState(), lang)}` : notice
  }

  /**
   * Ferme la ville pour un cycle.
   *
   * Le cookie signé est posé par le SERVEUR : lui seul peut refuser les requêtes
   * suivantes, et le client ne peut ni le lire ni l'écrire. Si l'appel échoue on
   * ferme quand même l'écran — le serveur compte les tours de son côté et
   * refusera le prochain de toute façon.
   */
  async function closeCity(): Promise<void> {
    const scene = playerStore.scene
    const hours = scene?.pacing?.lock_hours ?? 24
    let until = Date.now() + hours * 3600_000
    // Le texte que le serveur a rangé dans le cookie fait foi : c'est celui qui
    // reviendra au rechargement, et l'écran ne doit pas en montrer un autre
    // maintenant. Celui de la scène en main ne sert que si l'appel échoue.
    let text = scene?.game_over
    try {
      const lock = await $fetch<{ until: number; text?: string }>(
        '/api/lockout', { method: 'POST' })
      until = lock.until
      if (lock.text) text = lock.text
    } catch {
      // Sans réponse, on garde l'échéance estimée : l'écran ne doit jamais
      // rester ouvert sur une saisie qui ne partira plus.
    }
    gameStore.closeCity({ until, reason: 'stalled', text })
  }

  /**
   * Joue une saisie : on tire, on exécute.
   *
   * Le tirage lui-même est gratuit — dix prédicats sur des booléens. Seul le
   * moment `model` déclenche un appel facturé, et il n'est atteint que si
   * aucun des moments locaux ne l'a coiffé.
   */
  /**
   * Mettre dans sa poche une chose du décor dont on sait lire le nom.
   *
   * Deux chemins y mènent et doivent emporter la même chose : la saisie qui la
   * nomme, et la glissière qui paraît au bout de l'analyse. Recopier ce que
   * l'objet garde de sa scène dans chacun, et l'un d'eux oublierait un jour la
   * couleur d'une carte.
   */
  function take(obj: Interactable) {
    if (gameStore.inventory.some(o => o.id === obj.id)) return
    gameStore.pickUp({
      id: obj.id,
      label: obj.label,
      from: playerStore.scene?.place?.name,
      // La scène a dit en le posant s'il valait pour quelqu'un d'autre :
      // c'est ce qui décide qu'un personnage pourra le réclamer, ici ou
      // trois scènes plus loin. Dans le doute, il n'éclaire que la quête.
      kind: obj.item_kind === 'carte' ? 'key' : obj.item_kind === 'echange' ? 'trade' : 'lore',
      // Une carte garde sa couleur : c'est par elle qu'un lecteur la réclame.
      ...(obj.item_kind === 'carte' ? { color: obj.card_color, hex: obj.card_hex } : {}),
      observation: observationOf(
        playerStore.scene, gameStore.inventory, obj.id,
        playerStore.language, gameStore.revealedInteractableIds),
      icon: obj.icon,
    })
    gameStore.addNarrativeEntry(
      'system', translate(playerStore.language, 'game.pickup', { label: obj.label }))
  }

  async function play(input: string): Promise<void> {
    const q = snapshot(input)
    const moment = draw(q)
    // Noté APRÈS l'instantané : le regard qui compte pour la fréquence est le
    // deuxième, celui-ci ne se compte pas lui-même.
    const scene = playerStore.scene
    const looked = scene ? lookedThing(input, scene, oracleState(), playerStore.language) : null
    if (looked) gameStore.recordLook(looked)

    // Le canal '#' inscrit lui-même la commande au fil : il ne passe pas par
    // le monde, il parle au scénario.
    if (moment.play.kind === 'command') {
      runSceneCommand(input)
      return
    }

    gameStore.addNarrativeEntry('player_command', input)

    // Tout ce qui n'est pas une réplique referme la conversation en cours : on
    // ne reste pas en tête-à-tête avec quelqu'un pendant qu'on pousse la porte
    // ou qu'on lit le récapitulatif de sa quête.
    if (moment.play.kind !== 'model') gameStore.leaveConversation()

    if (moment.play.kind === 'exit') {
      const gate = playerStore.scene?.paywall.gate_text
      if (gate) gameStore.addNarrativeEntry('narration', gate)
      setTimeout(openExit, 1400)
      return
    }

    // IL LE PREND PARCE QU'IL L'A DEMANDÉ. Rien ne part au modèle et rien ne
    // se compte : c'est un geste, comme l'était le bouton qu'il remplace — la
    // différence est que l'initiative vient de lui, et qu'il a fallu savoir
    // nommer la chose pour en arriver là.
    if (moment.play.kind === 'pickup') {
      const obj = claimed(input)
      if (obj) take(obj)
      gameStore.setPlayingSubState('awaiting_input')
      return
    }

    if (moment.play.kind === 'search') {
      puzzle.search(input)
      gameStore.setPlayingSubState('awaiting_input')
      return
    }

    if (moment.play.kind === 'local') {
      // La nuit se referme. Le texte a été écrit à la génération de la scène :
      // on ne fait pas patienter vingt secondes quelqu'un à qui on ferme la
      // porte, et la fermeture ne coûte pas un tour de plus.
      if (moment.play.say === 'game_over') {
        await closeCity()
        return
      }
      // Une réponse anonyme ne consomme pas de tour : le joueur n'a rien joué,
      // il lui manque un outil.
      // Idem pour l'outil jamais employé : il lui manque un geste, pas un tour.
      if (moment.play.say === 'nobody'
        || moment.play.say === 'unused_lens'
        || moment.play.say === 'unread_object'
        || moment.play.say === 'blocked_exit') {
        gameStore.addNarrativeEntry('system', localText(moment.play.say, q))
        gameStore.setPlayingSubState('awaiting_input')
        return
      }
      answerLocally(input, localText(moment.play.say, q), q.localAnswer?.npcName)
      return
    }

    await runTurn(input, moment.play.mode, moment.after ?? ([] as StoryletEffect[]))
  }

  return { play, snapshot, take }
}
