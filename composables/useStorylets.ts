import type { Qualities, StoryletEffect } from '~/utils/storylets'
import { draw } from '~/utils/storylets'
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useNarrative } from '~/composables/useNarrative'
import { usePaywall } from '~/composables/usePaywall'
import { useSceneCommands } from '~/composables/useSceneCommands'
import { resolveLocally, buildGuidance, lookedThing } from '~/utils/scene-oracle'
import { translate, pack } from '~/utils/languages'
import { isQuestion, matchesKeyword, normalize } from '~/utils/text-match'
import { CARD_HALF_2_ID, isPieceId, takeTarget, observationOf } from '~/utils/interactables'
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

  /**
   * Le personnage attend-il une réponse ?
   *
   * Oui si sa dernière réplique à ce joueur était une question : ce qu'on lui
   * tape ensuite y répond, même sans point d'interrogation. Lu sur son fil à
   * lui, pas sur le récit — un autre personnage a pu parler entre-temps.
   */
  function awaitsAnswer(npcId: string): boolean {
    const said = (gameStore.npcThreads[npcId] ?? []).filter(m => m.role === 'assistant').at(-1)?.content ?? ''
    return /[?¿؟？]\s*\S{0,3}\s*$/.test(said.trim())
  }

  /**
   * La saisie cite-t-elle un nom qu'on peut taper ?
   *
   * Les noms en PascalCase du récit — objet, décor, augmentation, sortie — sont
   * ce que le joueur est invité à saisir : en parler à quelqu'un n'a pas à
   * prendre la forme d'une question. Le nom du personnage seul aussi : c'est
   * ainsi qu'on l'aborde. Soudés ou non : « FocaleBraise » se tape aussi
   * « focale braise ».
   */
  function citesName(input: string, npc?: { name: string }): boolean {
    const scene = playerStore.scene
    if (!scene) return false
    const text = normalize(input)
    const flat = text.replace(/[\s-]+/g, '')
    const names = [
      ...scene.interactables.map(i => i.label),
      ...(scene.decor ?? []).map(d => d.name),
      scene.key_item?.name,
      scene.sealed_object?.name,
      scene.exit_label,
      scene.place?.name,
    ]
    const cited = names.some((name) => {
      const n = normalize(name ?? '').replace(/[\s-]+/g, '')
      return n.length >= 3 && flat.includes(n)
    })
    if (cited) return true
    if (!npc) return false
    const rest = normalize(npc.name).split(' ')
      .reduce((left, part) => left.replace(part, ''), text)
    return !rest.replace(/[^\p{L}\p{N}]+/gu, '')
  }

  /**
   * La saisie se sert-elle d'une carte ?
   *
   * Un verbe d'usage — utiliser, insérer, badger —, et la carte : par son nom,
   * soudé ou non, ou par le simple mot « carte ». « Utilise la Carte Ocre pour
   * ouvrir le passage » et « je passe la carte » valent autant.
   */
  function usesCard(input: string): boolean {
    const words = pack(playerStore.language).input
    if (!matchesKeyword(input, words.use ?? [])) return false
    const name = normalize(playerStore.scene?.key_item?.name ?? '').replace(/[\s-]+/g, '')
    const flat = normalize(input).replace(/[\s-]+/g, '')
    return (name.length >= 3 && flat.includes(name)) || matchesKeyword(input, words.card ?? [])
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
    // dollars n'est qu'un filet si les prompts venaient à grossir. En
    // développement ni l'un ni l'autre : une scène se teste jusqu'au bout.
    const capReached = !import.meta.dev
      && (pacing?.hard_turn_cap ?? 0) > 0
      && gameStore.modelTurnsUsed >= pacing!.hard_turn_cap
    const budgetReached = !import.meta.dev
      && (pacing?.budget_usd ?? 0) > 0
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
      questionsOnly: Boolean(pacing?.questions_only),
      asksQuestion: isQuestion(input, pack(playerStore.language).input.question ?? []),
      npcAwaitsAnswer: Boolean(npc) && awaitsAnswer(npc!.id),
      citesName: citesName(input, npc),

      sceneHasKeyItem: Boolean(item),
      hasKeyItem: gameStore.hasKeyItem,
      pendingKeyItem: gameStore.pendingKeyItem,
      missingPiece: Boolean(scene?.required_item_id)
        && !gameStore.inventory.some(o => o.id === scene!.required_item_id),
      cardDoor: Boolean(scene?.opens_with_card),
      usesCard: Boolean(scene?.opens_with_card) && usesCard(input),
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
    say: 'oracle' | 'nobody' | 'unused_lens' | 'unread_object' | 'exhausted' | 'blocked_exit' | 'card_reader' | 'not_asked',
    q: Qualities,
    input = '',
  ): string {
    const scene = playerStore.scene
    const lang = playerStore.language
    const t = (key: string, vars?: Record<string, string>) => translate(lang, key, vars)

    if (say === 'oracle') return q.localAnswer?.text ?? ''
    if (say === 'nobody') return t('oracle.no_name')
    if (say === 'unread_object') return t('oracle.unread_object')
    // Il ne relève pas : la phrase glisse, et le récit dit pourquoi.
    if (say === 'not_asked') {
      return t('npc.no_question', { name: interlocutor(input)?.name ?? '' })
    }
    // Deux tournures, en alternance : la même phrase deux fois de suite se lit
    // comme un message d'erreur.
    if (say === 'card_reader') return t('puzzle.reader_waits')
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
    // La seconde moitié d'une carte ne se range pas à côté de la première :
    // elle s'y emboîte, et c'est la carte entière qui entre en poche.
    if (obj.card_half && isPieceId(obj.id, CARD_HALF_2_ID)) {
      puzzle.joinHalves()
      return
    }
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
    // Seule exception : le personnage qui ne relève pas. Il reste en face, et la
    // question qu'on lui posera ensuite doit lui parvenir sans retaper son nom.
    if (moment.play.kind === 'local' && moment.play.say === 'not_asked') {
      const npc = interlocutor(input)
      gameStore.setActiveNpc(npc?.id ?? null)
      gameStore.addNarrativeEntry('narration', localText('not_asked', q, input))
      gameStore.setPlayingSubState('awaiting_input')
      return
    }
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
        || moment.play.say === 'blocked_exit'
        || moment.play.say === 'card_reader') {
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
