import type { SceneNPC, TurnContext, TurnMode, TurnUsage } from '~/types/scene'
import type { StoryletEffect } from '~/utils/storylets'
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { normalize, matchesKeyword, significant } from '~/utils/text-match'
import { pack, translate } from '~/utils/languages'

/** Durée totale au-delà de laquelle on considère le tour perdu. */
const TURN_TIMEOUT_MS = 60_000
/** Silence toléré entre deux fragments avant de déclarer le flux mort. */
const STALL_TIMEOUT_MS = 20_000

/**
 * Un tour de jeu, et lui seul.
 *
 * Ce composable ne décide plus de CE QUI doit être joué — c'est le rôle du
 * deck, dans `utils/storylets.ts`, tiré par `useStorylets`. Il reçoit un mode
 * déjà choisi et se charge du reste : trouver l'interlocuteur, tenir les
 * compteurs qui font avancer la chaîne de l'objet, streamer, appliquer les
 * effets du moment.
 *
 * Le prompt système est bâti côté serveur depuis script.json ; on n'envoie ici
 * que les faits de la scène courante.
 */
export function useNarrative() {
  const { t } = useLang()
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  // Pris ici, pas au fil du tour : après un `await`, le contexte de Nuxt n'est
  // plus garanti, et l'horloge en a besoin pour connaître l'ordre des scènes.

  function buildContext(): TurnContext | null {
    const scene = playerStore.scene
    if (!scene) return null
    return {
      player_name: playerStore.playerName,
      player_agreement: playerStore.playerAgreement ?? undefined,
      place: scene.place,
      quest: scene.quest,
      night_goal: scene.night?.goal,
      planned: scene.planned ?? undefined,
      npcs: scene.npcs,
      theme: scene.theme ?? null,
      key_item: scene.key_item ?? null,
      has_key_item: gameStore.hasKeyItem,
      informed_about_item: gameStore.informedAboutItem,
      // Ce qu'il porte À CET INSTANT : sans ça un personnage réclamerait encore
      // l'objet qu'il vient de recevoir.
      carried_ids: gameStore.inventory.map(o => o.id),
      offered_item: offeredItem(),
      // Le nom de ce qu'un échange découvrirait : les éléments cachés sont
      // écrits par le modèle, le serveur ne les connaît pas, et c'est pourtant
      // lui qui doit redire ce nom au personnage qui va le montrer.
      reveal_label: revealLabel(),
    }
  }

  /** Le libellé de l'élément caché qu'un échange de cette scène découvrirait. */
  function revealLabel(): string | undefined {
    const scene = playerStore.scene
    const id = scene?.npcs.find(n => n.wants?.reveals_id)?.wants?.reveals_id
    if (!id) return undefined
    return scene?.interactables.find(o => o.id === id)?.label
  }

  /**
   * L'objet que le joueur tend, s'il en tend un.
   *
   * Posé par le clic sur « Donner » et lu ici : le tour part avec l'objet, mais
   * l'inventaire ne bouge pas tant que le personnage n'a pas dit s'il le prend.
   */
  function offeredItem() {
    const pending = gameStore.pendingGive
    if (!pending) return null
    const item = gameStore.inventory.find(o => o.id === pending.itemId)
    if (!item) return null
    return {
      id: item.id,
      name: item.label,
      known: gameStore.decryptedObjectIds.includes(item.id),
    }
  }

  /**
   * Le contexte, complété du compteur d'échanges avec CE personnage.
   *
   * Il ne peut pas vivre dans `buildContext()`, qui ne sait pas à qui l'on
   * parle : c'est au moment d'envoyer le tour qu'on connaît l'interlocuteur.
   */
  function contextFor(npc?: SceneNPC): TurnContext | null {
    const ctx = buildContext()
    if (!ctx) return null
    return { ...ctx, npc_exchanges: npc ? gameStore.npcExchanges[npc.id] ?? 0 : 0 }
  }

  /**
   * Le personnage NOMMÉ dans la saisie, s'il y en a un.
   *
   * C'est par là qu'une conversation s'ouvre — jamais par là qu'elle se
   * poursuit : voir `interlocutor`, juste en dessous.
   */
  function findAddressedNpc(input: string): SceneNPC | undefined {
    const text = normalize(input)
    const npcs = playerStore.npcs

    // UNIQUEMENT le nom. Reconnaître l'archétype — « je parle au barman » —
    // rouvrirait une porte dérobée : on pourrait jouer sans jamais déchiffrer
    // une identité, et l'oeil bionique ne servirait plus à rien.
    return npcs.find(npc =>
      normalize(npc.name).split(' ').some(part => significant(part, 2) && text.includes(part))
    )
  }

  /**
   * Les trois listes qui lisent la saisie, dans la langue de la partie.
   *
   * Elles étaient écrites en dur, en français. Hors français elles ne
   * reconnaissaient rien : personne ne pouvait s'adresser à quelqu'un sans le
   * nommer, ni mettre fin à une conversation, ni se détourner vers le décor.
   *
   * Reconnues comme MOTS ENTIERS, jamais comme fragments : « va » cherché en
   * sous-chaîne se trouvait dans « ça va », et un joueur qui demandait des
   * nouvelles à quelqu'un se retrouvait à fixer le comptoir.
   */
  const verbs = computed(() => {
    const input = pack(playerStore.language).input
    return {
      address: input.address,
      leave: input.leave,
      exitStrict: input.exit_strict,
      // Manipuler, examiner, ramasser : tout ce qui vise une chose et non
      // quelqu'un. Les trois listes sont reunies parce que `turnsAway` ne fait
      // pas la difference - s'emparer d'un objet detourne autant que l'ouvrir.
      world: [...input.world, ...input.look, ...input.take],
    }
  })

  /** Un élément du décor est-il nommé dans la saisie ? */
  function namesDecor(text: string): boolean {
    return (playerStore.scene?.decor ?? []).some(dec => {
      const words = normalize(dec.name ?? '')
        .split(' ')
        .filter(w => significant(w, 3))
      return words.some(w => text.includes(w))
    })
  }

  /**
   * Le joueur se détourne-t-il de son interlocuteur ?
   *
   * Trois façons, et pas une de plus : le dire, viser la sortie, ou porter la
   * main sur quelque chose du décor. Tout le reste — une question sèche, un
   * « oui », un « pourquoi ? », un pronom — reste adressé à la personne en
   * face, puisque c'est à elle qu'on parlait.
   */
  function turnsAway(input: string): boolean {
    const text = normalize(input)
    if (verbs.value.leave.some(phrase => text.includes(normalize(phrase)))) return true

    // Les départs sans équivoque seulement : on n'appelle `turnsAway` que
    // lorsqu'une conversation est ouverte, et ses réponses sont pleines de
    // « suis », de « va » et de « la nuit ».
    if (matchesKeyword(input, verbs.value.exitStrict)) return true

    return matchesKeyword(input, verbs.value.world) && namesDecor(text)
  }

  /**
   * À QUI cette saisie s'adresse.
   *
   * Le nom l'emporte toujours — c'est ainsi qu'on ouvre une conversation, et
   * ainsi qu'on passe d'une personne à l'autre ; l'oeil bionique garde donc
   * tout son rôle. Mais une fois la conversation ouverte, elle DURE : ce qui
   * est tapé ensuite va à la même personne tant que le joueur ne s'en détourne
   * pas. Sans ça, un personnage posait une question et la réponse du joueur
   * partait en narration d'ambiance ; on lui répondait à côté, toujours.
   */
  function interlocutor(input: string): SceneNPC | undefined {
    const named = findAddressedNpc(input)
    if (named) return named

    const active = playerStore.npcs.find(n => n.id === gameStore.activeNpcId)
    if (!active) return undefined

    return turnsAway(input) ? undefined : active
  }

  /**
   * Le joueur parle-t-il de sortir ?
   *
   * Seul face au décor, la liste large de la scène : verbes de mouvement et
   * mots du libellé. Face à quelqu'un, les départs explicites seulement — sans
   * quoi la réponse à une question du détenteur se lisait comme un départ, la
   * conversation se refermait et il la reposait au tour suivant.
   */
  function mentionsExit(input: string): boolean {
    const scene = playerStore.scene
    if (!scene) return false
    // `interlocutor` a déjà tranché : s'il s'est détourné — « je te laisse » —
    // la conversation est finie et la liste large reprend ses droits.
    const words = interlocutor(input)
      ? verbs.value.exitStrict
      : scene.paywall.exit_keywords
    return matchesKeyword(input, words)
  }

  /** Le joueur s'adresse à quelqu'un sans le nommer : il lui manque l'outil. */
  function addressesNobody(input: string): boolean {
    const text = normalize(input)
    if (interlocutor(input)) return false
    return verbs.value.address.some(v => text.includes(normalize(v)))
  }

  async function streamTurn(input: string, npc?: SceneNPC, mode?: TurnMode): Promise<string> {
    const context = contextFor(npc)
    if (!context) return ''

    gameStore.clearTurnError()
    gameStore.setPlayingSubState(npc ? 'npc_dialogue' : 'narrative_streaming')
    gameStore.addNarrativeEntry(npc ? 'npc_speech' : 'narration', '', npc?.name)

    const controller = new AbortController()
    const overall = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS)

    // Relancé à chaque fragment reçu : coupe un flux qui reste muet.
    let stall: ReturnType<typeof setTimeout> | null = null
    const resetStall = () => {
      if (stall) clearTimeout(stall)
      stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
    }

    let fullText = ''

    try {
      resetStall()

      const response = await fetch('/api/narrative/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sceneId: playerStore.scene?.scene_id,
          // La langue part avec le tour : le corps fait foi cote serveur, le
          // cookie n'est que son repli.
          lang: playerStore.language,
          context,
          input,
          npcId: npc?.id,
          mode,
          turnCount: gameStore.turnCount,
          // Le fil de CE personnage quand on parle à quelqu'un, le fil commun
          // sinon. Lui remettre la narration d'ambiance et les répliques des
          // autres noyait sa propre dernière phrase : il ne se souvenait pas
          // de ce qu'il venait de demander, donc il le redemandait.
          history: npc ? gameStore.npcThreads[npc.id] ?? [] : gameStore.conversationHistory,
        }),
      })

      /**
       * 423 : la ville s'est fermée sous les pieds du joueur.
       *
       * Le serveur compte les tours de son côté et n'attend l'accord de
       * personne — c'est le filet quand le client n'a pas déclenché la
       * fermeture lui-même. Sans ce cas, le joueur voyait « Le serveur a
       * répondu 423 » et restait devant sa saisie : un game over qui ressemble
       * à une panne. Le texte vient du cookie, écrit pour cette scène-là.
       */
      if (response.status === 423) {
        const closed = await response.json().catch(() => null) as
          { data?: { lockedUntil?: number; text?: string } } | null
        gameStore.removeLastNarrativeEntry()
        gameStore.closeCity({
          until: closed?.data?.lockedUntil ?? Date.now() + 24 * 3600_000,
          reason: 'stalled',
          text: closed?.data?.text ?? playerStore.scene?.game_over,
        })
        return ''
      }

      // 503 : le modèle a refusé le tour (crédit épuisé, débit dépassé). La
      // cause technique reste dans les journaux du serveur ; le joueur, lui,
      // voit un narrateur indisponible, pas un code HTTP.
      if (response.status === 503) {
        const failed = await response.json().catch(() => null) as
          { data?: { reason?: string } } | null
        if (failed?.data?.reason === 'narrator_unavailable') {
          throw new Error(t('errors.narrator_unavailable'))
        }
      }

      if (!response.ok || !response.body) {
        throw new Error(t('errors.server_status', { status: response.status }))
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetStall()

        // Un chunk réseau peut couper une ligne SSE en deux.
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as { text?: string; usage?: TurnUsage }
            if (parsed.text) {
              gameStore.updateLastNarrativeEntry(parsed.text)
              fullText += parsed.text
            }
            if (parsed.usage) {
              const pacing = playerStore.scene?.pacing
              gameStore.recordSpend(
                parsed.usage.prompt_tokens,
                parsed.usage.completion_tokens,
                pacing?.price_input_per_1m_usd ?? 0,
                pacing?.price_output_per_1m_usd ?? 0
              )
            }
          } catch { /* fragment incomplet, ignoré */ }
        }
      }

      // Un flux qui se termine sans un mot est un échec, pas un tour vide.
      if (!fullText.trim()) throw new Error(t('errors.narrator_mute'))

      gameStore.setPlayingSubState('awaiting_input')
      return fullText
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      gameStore.removeLastNarrativeEntry()
      gameStore.setTurnError(
        aborted
          ? t('errors.narrator_timeout')
          : err instanceof Error ? err.message : t('errors.narrator_cut')
      )
      return ''
    } finally {
      clearTimeout(overall)
      if (stall) clearTimeout(stall)
    }
  }

  /**
   * Applique ce que le moment tiré change dans l'état.
   *
   * Toujours APRÈS le tour, jamais avant : un tour qui échoue ne doit pas
   * laisser derrière lui un objet tendu que personne n'a jamais offert.
   */
  function applyEffects(effects: StoryletEffect[]) {
    // Qui vient de recevoir quoi : `consume_given_item` efface `pendingGive`,
    // et la récompense se lit dessus. On la capture donc avant la boucle.
    const give = gameStore.pendingGive

    for (const effect of effects) {
      // L'objet est TENDU, pas donné : le joueur doit le prendre lui-même. Un
      // objet qui apparaît tout seul dans l'inventaire ne se remarque pas.
      if (effect === 'offer_key_item' && !gameStore.hasKeyItem) gameStore.offerKeyItem()
      // L'ÉCHANGE FAIT AVANCER. Il délie une langue — c'est la réplique qui
      // vient d'être jouée —, et il peut faire deux choses de plus : remettre
      // un objet, ou découvrir un morceau du décor que personne ne voyait.
      if (effect === 'grant_reward' && give) grantReward(give.npcId)
      // L'échange est définitif : l'objet quitte l'inventaire une fois la
      // réplique jouée, jamais avant. Un tour qui échoue ne coûte rien.
      if (effect === 'consume_given_item') gameStore.consumeGivenItem()
    }
  }

  /**
   * Ce que l'échange rend, une fois la réplique passée.
   *
   * Écrit à la génération de la scène, donc gratuit : ni l'objet remis ni
   * l'élément découvert ne coûtent un appel de plus. Le texte, lui, a déjà été
   * dit par le personnage — ici on ne fait qu'enregistrer ce qui a changé.
   */
  function grantReward(npcId: string) {
    const wants = playerStore.npcs.find(n => n.id === npcId)?.wants
    if (!wants) return

    const gift = wants.reward_item
    if (gift?.id && gift.label) {
      gameStore.pickUp({
        id: gift.id,
        label: gift.label,
        from: playerStore.scene?.place?.name,
        kind: gift.item_kind === 'echange' ? 'trade' : 'lore',
        observation: gift.observation,
        icon: gift.icon,
      })
      // Il le nomme en le tendant : ce qu'on reçoit en parlant arrive en clair.
      gameStore.markDecrypted(gift.id)
      gameStore.addNarrativeEntry(
        'system',
        translate(playerStore.language, 'game.received', { label: gift.label }))
    }

    // Découvert, pas ramassé : l'élément EXISTE désormais dans la salle, et le
    // joueur en fait ce qu'il veut — le prendre s'il se prend, l'ouvrir sinon.
    if (wants.reveals_id) gameStore.revealInteractable(wants.reveals_id)

    // La relique : l'informateur vient de nommer le détenteur en échange.
    const item = playerStore.scene?.key_item
    if (item?.relic && npcId === item.informant_npc_id) gameStore.markInformedAboutItem()
  }

  /**
   * Joue un tour facturé.
   *
   * `mode` et `after` viennent du deck. Ce qui reste ici est la comptabilité
   * du monde : elle s'applique à CHAQUE tour, quel que soit le moment tiré,
   * et c'est elle qui fait mûrir les qualités que le deck relira au tour
   * suivant.
   */
  async function runTurn(input: string, mode?: TurnMode, after: StoryletEffect[] = []) {
    // Retenus pour la relance : un tour qui a échoué se rejoue à l'identique,
    // effets compris — sinon une remise ratée laisserait la scène sans sortie.
    gameStore.setLastCommand(input)
    gameStore.setLastMode(mode ?? null)
    gameStore.setLastEffects(after)

    // Une relance vers la sortie est narrée, jamais jouée par un PNJ.
    const narrated = mode === 'exit_nudge' || mode === 'blocked_exit'
    // Un don désigne son destinataire par le clic, pas par la phrase : c'est
    // celui à qui le joueur parlait, et son nom n'a pas à être retapé.
    const offeredTo = gameStore.pendingGive
      ? playerStore.npcs.find(n => n.id === gameStore.pendingGive!.npcId)
      : undefined
    const npc = narrated ? undefined : (offeredTo ?? interlocutor(input))
    // Ouvre, maintient ou ferme la conversation — c'est la même ligne pour les
    // trois : `interlocutor` a déjà décidé si elle survit à cette saisie.
    gameStore.setActiveNpc(npc?.id ?? null)

    const item = playerStore.scene?.key_item

    if (npc) gameStore.recordNpcTalk(npc.id)

    // La relique (A3S1) : personne ne mène au détenteur tant que l'informateur
    // n'a pas reçu l'objet qu'il attend.
    const wanted = item?.relic
      ? playerStore.npcs.find(n => n.id === item.informant_npc_id)?.wants?.item_id : undefined
    const awaitsTrade = Boolean(wanted && gameStore.inventory.some(o => o.id === wanted))

    // Parler à l'informateur ouvre la chaîne — mais pas au premier bonjour. Il
    // faut lui avoir parlé deux ou trois fois : avant, il jauge, et il ne
    // nomme personne.
    const beforeSteer = playerStore.scene?.pacing?.exchanges_before_steer ?? 2
    if (npc && item && npc.id === item.informant_npc_id && !gameStore.informedAboutItem && !awaitsTrade
      && (gameStore.npcExchanges[npc.id] ?? 0) >= beforeSteer) {
      gameStore.markInformedAboutItem()
    }

    // L'aide active fait venir l'informateur au joueur et lui fait nommer le
    // détenteur. Sans ce relais, l'état n'avancerait que si le joueur pensait
    // à l'interpeller : il se ferait aborder en boucle sans jamais progresser.
    const steerFrom = playerStore.scene?.pacing?.steer_after_turns
    if (item && !gameStore.informedAboutItem && !awaitsTrade && steerFrom && gameStore.turnCount >= steerFrom + 2) {
      gameStore.markInformedAboutItem()
    }

    // Le détenteur ouvre la piste lui-même. Sans ça, un joueur qui trouvait la
    // bonne personne SANS passer par l'informateur restait collé à elle —
    // `interlocutor` maintient l'interlocuteur actif — et aucun de ces tours ne
    // comptait : il se faisait esquiver jusqu'à la fermeture, au tour 10.
    // AVANT l'incrément ci-dessous : ce premier échange porte déjà la question
    // du détenteur — le prompt se construit après, piste ouverte. Compté après
    // coup, il laissait passer un tour de plus, où il reposait sa question à
    // un joueur qui venait d'y répondre. Le rythme est désormais celui qu'on
    // veut : il demande, le joueur répond, il commente et il cède.
    if (npc && item && npc.id === item.npc_id && !gameStore.informedAboutItem && !awaitsTrade) {
      gameStore.markInformedAboutItem()
    }

    // Les échanges ne comptent qu'une fois la piste connue : avant, le
    // détenteur ne parle pas de l'objet, ça ne fait pas avancer.
    if (npc && item && npc.id === item.npc_id && gameStore.informedAboutItem && !gameStore.hasKeyItem) {
      gameStore.recordKeyItemExchange()
    }

    gameStore.recordModelTurn()
    const text = await streamTurn(input, npc, mode)
    if (!text) return

    gameStore.incrementTurn(input, text, npc?.id)
    applyEffects(after)
    // Refus, ou tour qui n'était pas un don : la proposition retombe. Sans ça
    // l'objet resterait tendu et le tour suivant repartirait en échange.
    if (!after.includes('consume_given_item')) gameStore.clearPendingGive()
  }

  /**
   * Répond sans appeler le modèle, puis rend la réponse comme un tour normal.
   *
   * La scène générée contient déjà les descriptions du décor, ce que sait
   * chaque personnage et l'état de la quête : les ressortir ne justifie pas
   * une facturation.
   */
  function answerLocally(input: string, text: string, npcName?: string) {
    gameStore.addNarrativeEntry(npcName ? 'npc_speech' : 'narration', text, npcName)
    gameStore.incrementTurn(input, text)
    gameStore.setPlayingSubState('awaiting_input')
  }

  /** Rejoue le dernier tour sans redemander la commande au joueur. */
  async function retryLastTurn() {
    const input = gameStore.lastCommand
    if (!input) return
    await runTurn(input, gameStore.lastMode ?? undefined, gameStore.lastEffects)
  }

  return { runTurn, retryLastTurn, answerLocally, streamTurn, interlocutor, addressesNobody, mentionsExit }
}
