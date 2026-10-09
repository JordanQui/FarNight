import { defineStore } from 'pinia'
import type { GameScreen, PlayingSubState, NarrativeEntry, NarrativeEntryType } from '~/types/game'

export const useGameStore = defineStore('game', {
  state: () => ({
    currentScreen: 'init' as GameScreen,
    /**
     * La scène à construire ensuite.
     *
     * `null` = celle du départ. Renseignée quand on saute directement à une
     * scène, ce que fait la commande `#scene<n>`.
     */
    pendingSceneId: null as string | null,
    /**
     * La scène où le joueur en était, d'après le serveur.
     *
     * Posée au chargement par `/api/access`, qui lit un cookie signé : c'est la
     * seule mémoire qui survive à la fermeture de l'onglet. Elle n'est
     * renseignée que si la reprise est permise — première scène, ou droit
     * d'accès en cours. C'est elle que le bouton « Continuer » de l'accueil
     * suit.
     */
    resumeSceneId: null as string | null,
    /** Posé par « Donner la solution » : la scène reprise jouera `#solution`. */
    pendingSolution: false,
    playingSubState: 'awaiting_input' as PlayingSubState,
    narrativeHistory: [] as NarrativeEntry[],
    turnCount: 0,
    currentSceneImageUrl: null as string | null,
    sceneImageLoading: false,
    sceneImageError: null as string | null,
    /**
     * Celui à qui le joueur PARLE, tant qu'il ne s'en détourne pas.
     *
     * Ce n'était pas un état : on le redéduisait de chaque saisie, donc une
     * conversation durait exactement une phrase. Le personnage posait une
     * question, la réponse du joueur ne contenait plus son nom, et elle
     * repartait en narration d'ambiance — le jeu demandait quelque chose puis
     * ignorait la réponse. Une conversation s'OUVRE en nommant quelqu'un et se
     * FERME en se tournant vers autre chose ; entre les deux, tout ce qui est
     * tapé lui est adressé.
     */
    activeNpcId: null as string | null,
    /**
     * La conversation a vraiment commencé : le joueur a parlé à `activeNpcId`.
     * Un nom seulement visé l'arme sans l'ouvrir, et l'oeil reste en main.
     */
    conversing: false,
    paywallTriggered: false,
    /** Tours réellement facturés au modèle. Les réponses locales n'y entrent pas. */
    modelTurnsUsed: 0,
    /** Dépense cumulée de la scène, en dollars, d'après l'usage réel rapporté. */
    spentUsd: 0,
    /** Objet-clé DE LA SCÈNE EN COURS : sans lui, la sortie reste fermée. */
    hasKeyItem: false,
    /**
     * L'augmentation, acquise une fois pour toutes à l'auberge.
     *
     * Elle ne se confond pas avec l'objet-clé : celui-ci change à chaque scène
     * — une carte d'accès, une fréquence — et se perd en la quittant. La
     * faculté de lire le nom des choses, elle, ne se rend pas. Les avoir
     * confondues faisait qu'on arrivait à la scène 2 sans pouvoir rien lire,
     * y compris les objets ramassés juste avant.
     */
    hasAugmentation: false,
    /**
     * L'augmentation elle-même : son nom, ce qu'on en voit, et la scène qui
     * l'a remise.
     *
     * ELLE N'EST PAS DANS L'INVENTAIRE. Ce n'est pas un objet qu'on porte, qu'on
     * tend ou qu'on essaie sur une serrure : c'est une faculté greffée, et sa
     * seule trace à l'écran est la loupe. Rangée dans la grille, elle se
     * retrouvait entre deux cartes d'accès, proposée à l'échange et annoncée au
     * modèle comme un objet [OUVRE].
     */
    augmentation: null as null | {
      name: string; sceneId: string; from?: string
      observation?: string; icon?: string
    },
    /**
     * La fenêtre qui présente l'augmentation a été vue.
     *
     * Elle appartient à la PARTIE, pas à la scène : on ne réexplique pas la
     * loupe à chaque lieu traversé.
     */
    primerSeen: false,
    /** La fenêtre est à l'écran. Ouverte à la remise de l'augmentation. */
    primerOpen: false,
    /** Échanges déjà eus avec le détenteur de l'objet, une fois informé. */
    keyItemExchanges: 0,
    /** Un autre habitué a mis le joueur sur la piste de l'objet. */
    informedAboutItem: false,
    /** L'objet est proposé : il reste au joueur à le récupérer. */
    pendingKeyItem: false,
    /**
     * L'objet que le joueur vient de tendre, et à qui.
     *
     * Posé par le clic sur « Donner » dans la barre d'inventaire, lu par le
     * deck au tour suivant. Il ne quitte l'inventaire qu'une fois le tour joué :
     * si le personnage n'en veut pas, le joueur le garde.
     */
    pendingGive: null as { itemId: string; npcId: string } | null,
    /** Ce qui a changé de main. Un échange est définitif. */
    givenItemIds: [] as string[],
    /**
     * L'outil en main.
     *
     * `eye` lit les identités des gens, `lens` analyse les objets scellés —
     * cette dernière n'est disponible qu'une fois l'augmentation obtenue.
     * Le curseur, sur desktop, prend la forme de l'outil actif.
     */
    activeTool: 'eye' as 'eye' | 'lens',
    /**
     * Posture de lecture déclarée par le joueur.
     *
     * Assis, on tient le téléphone incliné vers soi ; allongé, on le tient
     * presque à l'horizontale au-dessus du visage. Le tangage neutre n'est pas
     * le même, et sans ce réglage la visée devient pénible dans l'une des deux
     * positions — l'oeil bute en haut ou en bas de l'écran.
     */
    posture: 'assis' as 'assis' | 'allonge',
    /**
     * La ville est fermée.
     *
     * `stalled` : la nuit a patiné, elle rouvre après un cycle. `completed` :
     * l'histoire est allée jusqu'au bout et ne se rejoue pas.
     *
     * `text` est écrit par le modèle — la nuit qui se referme vient de la scène,
     * l'adieu vient de l'épilogue et voyage dans le cookie signé pour survivre
     * au rechargement.
     */
    lock: null as { until: number; reason: 'stalled' | 'completed'; text?: string } | null,
    /** Le panneau de réglages est ouvert. */
    settingsOpen: false,
    /**
     * Le joueur est en train de taper.
     *
     * Sur mobile, l'oeil suit le téléphone en permanence : pendant qu'on écrit,
     * la main bouge, l'oeil balaie le texte et déclenche des noms — donc du son
     * — sans qu'on l'ait voulu. On le met en veille le temps de la saisie.
     */
    typing: false,
    /** Depuis quand. Sert de filet si un `blur` se perd. */
    typingSince: 0,
    /**
     * L'oeil est ouvert. Fermé, aucun nom ne se lit, à la souris comme au doigt :
     * c'est le bouton « Ouvrir l'œil » qui l'allume, partout.
     */
    eyeActive: false,
    /**
     * La fenêtre de l'oeil a été lue.
     *
     * Elle appartient à la PARTIE : on ne réexplique pas l'oeil à chaque lieu.
     * Une fois lue, le bouton ouvre l'oeil directement.
     */
    eyePrimerSeen: false,
    /**
     * La fenêtre « comment jouer » de l'auberge a été lue.
     *
     * Elle appartient à la PARTIE : elle s'ouvre à l'arrivée dans la première
     * scène, une fois, et ne revient ni au rechargement ni au lieu suivant.
     */
    howtoSeen: false,
    /**
     * L'oeil était ouvert quand la scène précédente s'est démontée.
     *
     * GameShell disparaît le temps du chargement de la scène suivante, et
     * l'oeil avec lui : sans ce drapeau, il fallait le rouvrir à chaque lieu.
     * Il ne survit pas au rechargement — iOS redemande alors un geste pour le
     * gyroscope, et le contexte audio aussi.
     */
    eyeWasOpen: false,
    /** Position de l'oeil, en fraction de l'écran. Au repos, en haut. */
    eyePos: { x: 0.5, y: 0.25 },
    /** Le nom en cours de lecture. Le reste du texte s'efface pendant ce temps. */
    revealing: null as string | null,
    /**
     * L'objet dont l'analyse est demandée, ou null.
     *
     * Posé ici plutôt que remonté par événement : la demande vient soit de la
     * souris, soit de l'oeil gyroscopique, et ces deux chemins n'ont aucun
     * composant en commun.
     *
     * Porte l'objet et non un booléen : depuis que le décor fouillé et les
     * objets reçus se déchiffrent eux aussi, l'épreuve n'est plus forcément
     * celle de l'objet scellé — il faut savoir LEQUEL est sous la loupe.
     */
    pendingChallenge: null as { id: string; label: string } | null,
    /** Un mot en gras touché dans le récit : GameShell le joue comme « examiner ». */
    lookRequest: null as string | null,
    /** Lecture refusée : tout le texte se brouille un instant. */
    readDenied: false,
    /**
     * Objets dont l'épreuve a été réussie : leur nom est lisible.
     * Vaut pour toute la partie — on ne redemande pas au joueur de refaire un
     * test qu'il a déjà passé.
     */
    decryptedObjectIds: [] as string[],
    /**
     * Ce que le joueur porte, depuis le début de la partie.
     *
     * L'inventaire ne se vide PAS en changeant de scène : un objet ramassé à
     * l'auberge peut être ce qui débloque le troisième étage. C'est l'historique
     * du chat qui en tient lieu à l'écran, mais la liste, elle, est ici.
     */
    inventory: [] as Array<{
      id: string
      label: string
      from?: string
      /**
       * Ce que l'objet fait.
       *
       * `key` : il OUVRE — carte d'accès, code, fréquence. Il sert à franchir
       * une porte ou à déverrouiller un terminal, ici ou plusieurs scènes plus
       * loin. `lore` : il ÉCLAIRE — il ne débloque rien, il approfondit la
       * quête et rapproche le joueur de ce qu'il doit finir par comprendre.
       */
      kind: 'key' | 'lore' | 'trade'
      /** Sa couleur, pour une carte. C'est par elle que le joueur la reconnaît. */
      color?: string
      /**
       * Cette couleur, en hexadécimal, figée AU RAMASSAGE.
       *
       * La pastille se peignait à l'accent de la scène affichée : une carte
       * prise trois scènes plus tôt y prenait la couleur du lieu où on la
       * regarde, et le joueur comparait une pastille qui ment à une serrure qui
       * dit vrai.
       */
      hex?: string
      /**
       * Ce que l'analyse révèle, recopié depuis la scène AU RAMASSAGE.
       *
       * Il fallait le figer là : une scène ne connaît que ses propres objets,
       * et le joueur doit pouvoir rouvrir trois scènes plus tard une chose
       * ramassée à l'auberge. Écrite à la génération, elle ne coûte rien à
       * transporter.
       */
      observation?: string
      /**
       * Son pictogramme, figé au ramassage pour la même raison. Absent des
       * objets pris avant qu'ils en aient : la grille dessine alors leur nature.
       */
      icon?: string
    }>,
    /** PNJ à qui le joueur a déjà parlé — ce qu'il a débloqué. */
    talkedToNpcIds: [] as string[],
    /**
     * Ce qu'un échange a fait apparaître dans cette scène.
     *
     * Un élément `hidden` n'existe pour personne avant qu'un personnage ne le
     * montre : c'est la seconde chose qu'un échange peut rendre, avec l'objet.
     * La liste se vide à la scène suivante — ce qui a été découvert ici ne
     * traverse pas la porte, seul l'inventaire voyage.
     */
    revealedInteractableIds: [] as string[],
    /**
     * Nombre d'échanges par personnage.
     *
     * Un PNJ qui livre ce qu'il sait à la première réplique n'a pas de
     * consistance : il faut lui avoir parlé deux ou trois fois. C'est ce
     * compteur qui décide quand il s'ouvre.
     */
    npcExchanges: {} as Record<string, number>,
    /** La scène a été dénouée : les personnages sont venus au joueur. */
    resolved: false,
    conversationHistory: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
    /**
     * Le fil de chaque personnage, séparément.
     *
     * `conversationHistory` mélange tout — narration d'ambiance, répliques de
     * trois personnages, relances vers la porte. Un PNJ à qui l'on revient
     * n'avait donc aucune mémoire propre : il relisait un fil où sa dernière
     * phrase était noyée, et il recommençait. Ici chacun garde la sienne, et
     * c'est elle qu'on lui remet quand on l'aborde à nouveau — c'est ce qui
     * fait qu'une deuxième conversation continue la première au lieu de la
     * rejouer.
     */
    npcThreads: {} as Record<string, Array<{ role: 'user' | 'assistant'; content: string }>>,
    /** Dernière commande jouée, pour pouvoir relancer un tour qui a échoué. */
    lastCommand: null as string | null,
    lastMode: null as import('~/types/scene').TurnMode | null,
    /**
     * Effets du moment tiré au dernier tour.
     *
     * Retenus pour la relance : sans eux, une remise dont le tour a échoué se
     * rejouait sans jamais tendre l'objet, et la scène restait sans sortie.
     */
    lastEffects: [] as import('~/utils/storylets').StoryletEffect[],
    turnError: null as string | null,

    /**
     * L'énigme de la scène a été ouverte — l'objet-clé déchiffré à la loupe.
     *
     * Avant, le lire suffisait à l'obtenir. Maintenant le lire la montre : il
     * reste à la résoudre.
     */
    puzzleUnlocked: false,
    /** Le panneau de l'énigme est à l'écran. */
    puzzleOpen: false,
    /** Les endroits déjà fouillés : on ne paie pas deux fois le même. */
    searchedSpotIds: [] as string[],
    /** Les choses déjà regardées ici : la fréquence se lit au deuxième regard. */
    lookedLabels: [] as string[],
  }),

  getters: {
    lastNarrativeEntry: (state) =>
      state.narrativeHistory[state.narrativeHistory.length - 1] ?? null,
    isInputDisabled: (state) =>
      state.playingSubState === 'narrative_streaming' ||
      state.playingSubState === 'npc_dialogue',
    /**
     * La loupe est en main possible. En dev, toujours : on n'a pas à refaire
     * la scène 1 pour tester la suite. Le serveur, lui, ne voit que
     * `hasAugmentation`.
     */
    lensAvailable: (state) => state.hasAugmentation || import.meta.dev,
  },

  actions: {
    /**
     * Change d'écran — sauf si la ville est fermée.
     *
     * L'écran de game over ne se dépasse pas : tant que le verrou tient, aucun
     * chemin ne ramène au jeu. Le serveur refuse déjà toute requête coûteuse en
     * 423, mais sans ce garde-fou le joueur pouvait revenir sur une saisie
     * morte — reprise, retour de paiement, « repartir de zéro » — et croire que
     * le jeu était cassé plutôt que fermé.
     */
    setScreen(screen: GameScreen) {
      if (this.lock && screen !== 'locked') return
      this.currentScreen = screen
    },

    /** Le point de reprise annoncé par le serveur. Null : rien à reprendre. */
    setResumePoint(sceneId: string | null) {
      this.resumeSceneId = sceneId
    },

    setPlayingSubState(subState: PlayingSubState) {
      this.playingSubState = subState
    },

    setLastCommand(input: string) {
      this.lastCommand = input
    },

    setLastMode(mode: import('~/types/scene').TurnMode | null) {
      this.lastMode = mode
    },

    setLastEffects(effects: import('~/utils/storylets').StoryletEffect[]) {
      this.lastEffects = effects
    },

    setTurnError(message: string) {
      this.turnError = message
      // Un tour en échec ne doit jamais laisser la saisie verrouillée.
      this.playingSubState = 'awaiting_input'
    },

    clearTurnError() {
      this.turnError = null
    },

    /** Retire l'entrée en cours de rédaction quand le tour a échoué. */
    removeLastNarrativeEntry() {
      this.narrativeHistory.pop()
    },

    addNarrativeEntry(type: NarrativeEntryType, text: string, npcName?: string) {
      this.narrativeHistory.push({
        id: `entry_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type,
        text,
        npcName,
        timestamp: Date.now(),
      })
    },

    updateLastNarrativeEntry(textChunk: string) {
      const last = this.narrativeHistory[this.narrativeHistory.length - 1]
      if (last) {
        last.text += textChunk
      }
    },

    setSceneImage(url: string) {
      this.currentSceneImageUrl = url
      this.sceneImageError = null
    },

    startSceneImage() {
      this.sceneImageLoading = true
      this.sceneImageError = null
    },

    failSceneImage(message: string) {
      this.sceneImageLoading = false
      this.sceneImageError = message
    },

    finishSceneImage() {
      this.sceneImageLoading = false
    },

    setActiveNpc(npcId: string | null) {
      this.activeNpcId = npcId
      this.conversing = npcId !== null
      if (npcId && this.activeTool === 'eye') this.revealing = null
    },

    /**
     * Un nom lu à l'oeil arme la saisie : la prochaine phrase part chez lui.
     * Pendant un tour en cours, on ne change pas d'interlocuteur sous les pieds
     * du récit. En pleine conversation, un nom que le PNJ vient de donner se
     * survole pour se tourner vers lui : la saisie doit suivre.
     */
    addressByName(name: string, npcs: Array<{ id: string; name: string }>) {
      if (this.isInputDisabled) return
      const npc = npcs.find(n => n.name.toLowerCase() === name.toLowerCase())
      if (!npc || this.activeNpcId === npc.id) return
      this.activeNpcId = npc.id
      this.conversing = false
    },

    /** Le joueur se détourne : ce qu'il tapera ensuite s'adresse au lieu. */
    leaveConversation() {
      this.activeNpcId = null
      this.conversing = false
    },

    /**
     * @param npcId le fil auquel ce tour appartient, s'il y en a un.
     *
     * Un tour joué avec quelqu'un s'inscrit DANS SON FIL et pas seulement dans
     * le fil commun : c'est ce qu'on lui remettra quand le joueur reviendra
     * lui parler.
     */
    incrementTurn(playerInput: string, aiResponse: string, npcId?: string | null) {
      this.turnCount++
      this.conversationHistory.push({ role: 'user', content: playerInput })
      this.conversationHistory.push({ role: 'assistant', content: aiResponse })
      if (this.conversationHistory.length > 12) {
        this.conversationHistory = this.conversationHistory.slice(-12)
      }

      if (!npcId) return
      const thread = this.npcThreads[npcId] ?? []
      thread.push({ role: 'user', content: playerInput })
      thread.push({ role: 'assistant', content: aiResponse })
      // Assez pour qu'une conversation tienne, borné pour que le prompt ne
      // grossisse pas indéfiniment : le coût d'un tour est déjà le poste qu'on
      // surveille.
      this.npcThreads[npcId] = thread.slice(-12)
    },

    unlockPuzzle() {
      this.puzzleUnlocked = true
      this.puzzleOpen = true
    },

    setPuzzleOpen(open: boolean) {
      this.puzzleOpen = open && this.puzzleUnlocked
    },

    recordSearch(spotId: string) {
      if (!this.searchedSpotIds.includes(spotId)) this.searchedSpotIds.push(spotId)
    },

    recordLook(label: string) {
      if (!this.lookedLabels.includes(label)) this.lookedLabels.push(label)
    },

    recordModelTurn() {
      this.modelTurnsUsed++
    },

    /** Ajoute le coût d'un appel, calculé sur les tokens réellement consommés. */
    recordSpend(promptTokens: number, completionTokens: number, inPer1m: number, outPer1m: number) {
      this.spentUsd += (promptTokens * inPer1m + completionTokens * outPer1m) / 1_000_000
    },

    /** Un échange de plus avec le détenteur de l'objet. */
    recordKeyItemExchange() {
      this.keyItemExchanges++
    },

    markInformedAboutItem() {
      this.informedAboutItem = true
    },

    /** Le détenteur tend l'objet. Le joueur doit encore le prendre. */
    offerKeyItem() {
      this.pendingKeyItem = true
    },

    /** Le joueur tend un objet à quelqu'un : le tour à venir dira ce qu'il en advient. */
    offerToNpc(itemId: string, npcId: string) {
      this.pendingGive = { itemId, npcId }
    },

    /**
     * L'échange a eu lieu : l'objet change de main, définitivement.
     *
     * Il sort de l'inventaire mais reste déchiffré : le joueur l'a lu, et ce
     * qu'il a compris ne se rend pas avec l'objet.
     */
    consumeGivenItem() {
      const pending = this.pendingGive
      this.pendingGive = null
      if (!pending) return
      this.inventory = this.inventory.filter(o => o.id !== pending.itemId)
      if (!this.givenItemIds.includes(pending.itemId)) this.givenItemIds.push(pending.itemId)
    },

    /** Le personnage n'en a pas voulu : le joueur le garde. */
    clearPendingGive() {
      this.pendingGive = null
    },

    setPosture(posture: 'assis' | 'allonge') {
      this.posture = posture
    },

    toggleSettings() {
      this.settingsOpen = !this.settingsOpen
    },

    setTool(tool: 'eye' | 'lens') {
      // La loupe n'existe pas tant que l'augmentation n'a pas été obtenue.
      if (tool === 'lens' && !this.lensAvailable) return
      this.activeTool = tool
      this.revealing = null
    },

    setTyping(typing: boolean) {
      this.typing = typing
      this.typingSince = typing ? Date.now() : 0
      // Ce qui était en cours de lecture s'arrête net : sans ça, la note du
      // dernier nom survolé continuerait pendant toute la saisie.
      if (typing) this.revealing = null
    },

    setEyeActive(active: boolean) {
      this.eyeActive = active
      if (active) this.eyeWasOpen = true
      if (!active) this.revealing = null
    },

    setEyePos(pos: { x: number; y: number }) {
      this.eyePos = pos
    },

    /**
     * Rien n'est mémorisé ici volontairement : le joueur doit retenir le nom.
     * C'est le coeur de la mécanique, pas un oubli.
     */
    setRevealing(name: string | null) {
      this.revealing = name
    },

    /**
     * Le joueur tente de lire sans l'oeil. Rien ne se révèle : au contraire,
     * tout le texte se brouille — c'est la réponse du système, pas un message.
     */
    denyRead() {
      this.readDenied = true
      setTimeout(() => { this.readDenied = false }, 700)
    },

    /**
     * Charge l'inventaire complet déclaré par le script.
     *
     * Développement seulement. Les noms viennent du script et ne sont jamais
     * générés : d'une session à l'autre ce sont les mêmes, et on peut tester
     * une scène tardive sans rejouer les précédentes. `pickUp` dédoublonne par
     * identifiant, donc l'appeler à chaque scène est sans effet de bord.
     */
    equipFromScript(kit: {
      augmentation?: boolean
      items?: Array<{
        id: string; label: string; kind: 'key' | 'lore' | 'trade'
        color?: string; hex?: string; from?: string; decrypted?: boolean
      }>
    } | null): number {
      if (!kit?.items?.length) return 0
      if (kit.augmentation) this.hasAugmentation = true
      let added = 0
      for (const o of kit.items) {
        const before = this.inventory.length
        this.pickUp({
          id: o.id, label: o.label, from: o.from, kind: o.kind,
          color: o.color || undefined, hex: o.hex || undefined,
        })
        if (this.inventory.length > before) added++
        if (o.decrypted) this.markDecrypted(o.id)
      }
      return added
    },

    /**
     * L'augmentation ne se PORTE que si on l'a ramassée là où elle se ramasse.
     *
     * `hasAugmentation` traverse la partie et revient du navigateur avec le
     * reste : un joueur qui recommençait une nuit — ou qui avait touché à
     * l'inventaire de développement — rouvrait l'auberge avec la loupe déjà en
     * barre d'outils, donc sans la seule boucle de jeu de la scène. On la lui
     * retire tant que l'objet-clé de CETTE scène n'est pas dans son inventaire :
     * c'est la seule preuve qu'un personnage la lui a tendue et qu'il l'a prise.
     */
    syncAugmentation(sceneId: string, grantsAugmentation: boolean) {
      this.liftLegacyAugmentation()
      if (!grantsAugmentation) return
      if (this.augmentation?.sceneId === sceneId) return
      this.augmentation = null
      this.hasAugmentation = false
      this.primerSeen = false
      this.primerOpen = false
      if (this.activeTool === 'lens') this.activeTool = 'eye'
    },

    /**
     * Une partie sauvegardée avant que l'augmentation quitte l'inventaire l'y
     * garde encore, sous l'id de l'objet-clé de sa scène : on l'en sort.
     */
    liftLegacyAugmentation() {
      const legacy = this.inventory.find(o => o.id === 'cle_auberge')
      if (!legacy) return
      this.augmentation ??= {
        name: legacy.label, sceneId: 'auberge', from: legacy.from,
        observation: legacy.observation, icon: legacy.icon,
      }
      this.hasAugmentation = true
      this.inventory = this.inventory.filter(o => o.id !== legacy.id)
    },

    markPrimerSeen() {
      this.primerOpen = false
      this.primerSeen = true
    },

    requestChallenge(id: string, label: string) {
      this.pendingChallenge = { id, label }
    },

    requestLook(label: string) {
      if (!this.isInputDisabled) this.lookRequest = label
    },

    clearChallenge() {
      this.pendingChallenge = null
    },

    /** Un personnage vient de découvrir cet élément : il existe désormais. */
    revealInteractable(id: string) {
      if (!this.revealedInteractableIds.includes(id)) this.revealedInteractableIds.push(id)
    },

    markDecrypted(id: string) {
      if (!this.decryptedObjectIds.includes(id)) this.decryptedObjectIds.push(id)
    },

    /**
     * @param from le lieu du ramassage, pour qu'une scène suivante puisse y renvoyer.
     * @param kind `key` s'il ouvre quelque chose, `lore` s'il éclaire la quête.
     */
    pickUp(item: {
      id: string
      label: string
      from?: string
      kind?: 'key' | 'lore' | 'trade'
      color?: string
      hex?: string
      observation?: string
      icon?: string
    }) {
      if (this.inventory.some(o => o.id === item.id)) return
      this.inventory.push({ kind: 'lore', ...item })
    },

    /**
     * @param grantsAugmentation vrai quand l'objet-clé de la scène EST
     * l'augmentation — c'est le cas de l'auberge, et d'elle seule. Elle, n'entre
     * pas dans l'inventaire : voir `augmentation`.
     * @param item l'objet-clé ramassé. Il ENTRE DANS L'INVENTAIRE : une carte
     * d'accès sert souvent plusieurs scènes plus loin, et elle disparaissait
     * avec sa scène — seul un booléen survivait, sans nom ni trace.
     */
    collectKeyItem(
      grantsAugmentation = false,
      item?: {
        id?: string; name: string; from?: string
        color?: string; hex?: string; observation?: string; icon?: string
        kind?: 'key' | 'trade'
      },
    ) {
      this.hasKeyItem = true
      this.pendingKeyItem = false
      // L'AUGMENTATION NE VA PAS DANS L'INVENTAIRE : elle se greffe, et la loupe
      // apparaît. Elle ouvre la sortie comme n'importe quel objet-clé, mais ne
      // se porte pas, ne se tend pas, ne se range pas avec les cartes.
      if (grantsAugmentation) {
        this.hasAugmentation = true
        // La fenêtre s'ouvre à la remise : c'est là que le joueur découvre ce
        // qu'il vient de recevoir. Une seule fois par partie.
        if (!this.primerSeen) this.primerOpen = true
        if (item?.name) {
          this.augmentation = {
            name: item.name,
            sceneId: item.id?.replace(/^cle_/, '') ?? '',
            from: item.from,
            observation: item.observation,
            icon: item.icon,
          }
        }
        return
      }
      if (item?.name) {
        this.pickUp({
          id: item.id || `cle_${this.inventory.length + 1}`,
          label: item.name,
          from: item.from,
          kind: item.kind ?? 'key',
          color: item.color,
          hex: item.hex,
          observation: item.observation,
          icon: item.icon,
        })
      }
    },

    recordNpcTalk(npcId: string) {
      if (!this.talkedToNpcIds.includes(npcId)) this.talkedToNpcIds.push(npcId)
      this.npcExchanges[npcId] = (this.npcExchanges[npcId] ?? 0) + 1
    },

    markResolved() {
      this.resolved = true
    },

    /**
     * Ferme la ville et bascule sur l'écran d'adieu.
     *
     * Le serveur tient la vérité — un cookie signé qu'aucune requête ne
     * franchit. Ceci n'est que l'affichage : sans lui, le joueur resterait
     * devant sa saisie et découvrirait la fermeture par une erreur 423.
     */
    closeCity(lock: { until: number; reason: 'stalled' | 'completed'; text?: string }) {
      this.lock = lock
      this.currentScreen = 'locked'
    },

    /**
     * Rouvre la ville. Réservé au développement.
     *
     * Le seul geste qui lève le verrou côté écran — il n'a de sens qu'accompagné
     * de `/api/lockout { open: true }`, qui efface le cookie ; sans lui le
     * prochain chargement referme aussitôt.
     */
    openCity() {
      this.lock = null
    },

    triggerPaywall() {
      this.paywallTriggered = true
      this.currentScreen = 'paywall'
    },

    /**
     * Repart sur une scène neuve, sans quitter la partie.
     *
     * Efface ce qui appartenait à la scène précédente — tours, dialogue,
     * objet-clé, personnages rencontrés.
     *
     * GARDE ce qui appartient à la PARTIE : le profil, le journal, la dépense,
     * l'augmentation, l'inventaire et les objets déjà déchiffrés. Le joueur
     * arrive dans une scène avec ce qu'il a récupéré dans les précédentes —
     * c'est souvent ce qui en résout le puzzle.
     */
    startNewScene(sceneId: string | null) {
      this.pendingSceneId = sceneId
      this.playingSubState = 'awaiting_input'
      this.narrativeHistory = []
      this.turnCount = 0
      this.currentSceneImageUrl = null
      this.sceneImageLoading = false
      this.sceneImageError = null
      this.activeNpcId = null
      this.conversing = false
      this.hasKeyItem = false
      this.keyItemExchanges = 0
      this.informedAboutItem = false
      this.pendingKeyItem = false
      this.pendingGive = null
      this.talkedToNpcIds = []
      // Ce qu'un échange avait découvert appartenait à cette salle-là.
      this.revealedInteractableIds = []
      this.npcExchanges = {}
      this.resolved = false
      this.conversationHistory = []
      this.npcThreads = {}
      this.lastCommand = null
      this.lastMode = null
      this.lastEffects = []
      this.turnError = null
      this.pendingChallenge = null
      this.puzzleUnlocked = false
      this.puzzleOpen = false
      this.searchedSpotIds = []
      this.lookedLabels = []
    },

    resetGame() {
      this.pendingSceneId = null
      this.resumeSceneId = null
      // Une partie neuve ne garde ni faculté, ni objets, ni noms déchiffrés :
      // sans ça, le joueur suivant commençait avec l'inventaire du précédent.
      this.hasAugmentation = false
      this.augmentation = null
      this.primerSeen = false
      this.primerOpen = false
      this.eyePrimerSeen = false
      this.howtoSeen = false
      this.eyeWasOpen = false
      this.inventory = []
      this.givenItemIds = []
      this.decryptedObjectIds = []
      this.activeTool = 'eye'
      // Repartir de zéro efface la partie, pas la fermeture : celle-ci vit dans
      // un cookie signé que le navigateur ne peut pas toucher. Rendre l'accueil
      // ici ne ferait que promettre une partie que le serveur refuserait.
      this.currentScreen = this.lock ? 'locked' : 'login'
      this.playingSubState = 'awaiting_input'
      this.narrativeHistory = []
      this.turnCount = 0
      this.currentSceneImageUrl = null
      this.sceneImageLoading = false
      this.sceneImageError = null
      this.activeNpcId = null
      this.conversing = false
      this.paywallTriggered = false
      this.modelTurnsUsed = 0
      this.spentUsd = 0
      this.hasKeyItem = false
      this.keyItemExchanges = 0
      this.informedAboutItem = false
      this.pendingKeyItem = false
      this.pendingGive = null
      this.talkedToNpcIds = []
      // Ce qu'un échange avait découvert appartenait à cette salle-là.
      this.revealedInteractableIds = []
      this.npcExchanges = {}
      this.resolved = false
      this.conversationHistory = []
      this.npcThreads = {}
      this.lastCommand = null
      this.lastMode = null
      this.lastEffects = []
      this.turnError = null
      this.puzzleUnlocked = false
      this.puzzleOpen = false
      this.searchedSpotIds = []
      this.lookedLabels = []
    },
  },
})
