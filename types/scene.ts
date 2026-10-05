// Ce que produit la fusion d'une scène de game/script.json avec un profil joueur.
// Le pipeline est découplé en deux phases :
//   1. POST /api/scene/text   -> texte + palette + décor + prompt image (~20 s)
//   2. POST /api/scene/image  -> illustration seule (~25 s)

export interface PaletteColor {
  hex: string
  name: string
  coverage_pct: number
  rationale: string
}

export interface ScenePalette {
  dominant: PaletteColor
  secondary: PaletteColor
  accent: PaletteColor
}

export interface DecorElement {
  slot_id: string
  name: string
  description: string
  /** Fragment anglais court, injecté tel quel dans le prompt image. */
  visual: string
}

export interface SceneNPC {
  id: string
  name: string
  archetype: string
  appearance: string
  personality: string
  /**
   * Ce qu'il est pour le joueur dans SA quête, tiré du dossier lu. Le récit le
   * montre en le présentant, et chaque réplique le lui rappelle (`role_rule`).
   */
  role?: string
  knows: string
  /**
   * Le morceau de ce qui attend DEHORS que ce personnage est seul à connaître.
   * Vide dans une scène qui n'en distribue pas. Voir `npcs.knowledge`.
   */
  beyond?: string
  /**
   * Ce que ce personnage réclame de ce que le joueur PORTE DÉJÀ.
   *
   * Au plus un personnage par scène en a un, et jamais dans la première : on y
   * arrive les mains nues. Lui donner l'objet ne débloque rien — ça délie une
   * langue, et c'est la seule façon d'obtenir ce que `reward` contient.
   */
  wants?: {
    item_id: string
    hint: string
    reward: string
    /**
     * Ce qu'il rend en échange, quand l'échange donne un objet.
     *
     * L'échange doit faire avancer : il délie une langue, il remet une chose,
     * ou il découvre un morceau du décor (`reveals_id`) — jamais deux à la fois.
     */
    reward_item?: {
      id: string
      label: string
      item_kind?: 'echange' | 'recit'
      observation?: string
      /** Son pictogramme, déjà reconstruit par le serveur. */
      icon?: string
    } | null
    /** L'id d'un interactable `hidden` que cet échange fait exister. */
    reveals_id?: string
  } | null
  opening_line: string
  /** Data URI, ajoutée après coup par /api/image/generate. */
  portraitUrl?: string
  /**
   * Syllabe de posture, sans tiret. Jamais affichée : elle dit la position du
   * personnage face à la tension du joueur, et détermine sa voix.
   */
  posture?: string
}

/**
 * L'augmentation remise par un PNJ.
 *
 * Ce n'est pas l'objet de la quête mais une CAPACITÉ : sans elle, les choses
 * du dehors n'ont pas de nom lisible, donc rien n'est manipulable. C'est le
 * laissez-passer vers la scène suivante.
 */
export interface SceneKeyItem {
  /** Id du PNJ qui le détient. Choisi par le modèle. */
  npc_id: string
  /**
   * Son nom propre.
   *
   * À l'auberge, c'est une désignation soudée en PascalCase — « FocaleBraise » —
   * dérivée de ce que la nuit oppose au joueur et de la tension de son signe. Le
   * récit la prononce dès l'ouverture, brouillée : le joueur la voit sans
   * pouvoir la lire, et c'est la démonstration de ce qui lui manque.
   */
  name: string
  description: string
  /**
   * Ce que le joueur comprend une fois le nom déchiffré à la loupe.
   *
   * Absente des scènes où l'objet-clé est une simple carte : là, le déchiffrer
   * donne son nom, pas une leçon.
   */
  observation?: string
  /** Ce qu'elle permet de percevoir dehors. */
  why: string
  /** La couleur de la carte, si c'en est une. C'est par elle qu'on la reconnaît. */
  color?: string
  /** Son pictogramme dans l'inventaire. Voir `utils/item-icon.ts`. */
  icon?: string
  /** Comment elle se porte : à l'oeil, sous la peau, au poignet. */
  worn?: string
  /** Ce que le détenteur attend du joueur avant de le céder. */
  handover_hint: string
  /** L'autre personnage, celui qui met sur la piste. Jamais le détenteur. */
  informant_npc_id: string
  /** Ce que l'informateur en dit : de quoi aller voir le détenteur. */
  informant_hint: string
  /** L'histoire qu'il raconte pour rendre l'objet désirable. */
  hook_story: string
  /**
   * L'acte que le joueur pourra accomplir une fois les noms lisibles.
   *
   * Déchiffrer n'est pas un but : c'est le moyen. Cet acte est ce que
   * l'augmentation rend possible et ce qui règle ce qui doit l'être — généré
   * pour ce joueur-là, d'après ce que la nuit lui oppose et la tension de son
   * signe. C'est une possibilité, jamais une conduite imposée.
   */
  resolving_action?: string
  /** Nombre d'échanges avec le détenteur avant la remise. */
  exchanges_before_handover: number
  /**
   * Comment il s'obtient. `found` : personne ne le détient, il est inscrit dans
   * le lieu, et c'est le déchiffrage de son nom qui le remet au joueur.
   */
  acquisition?: 'informant_then_holder' | 'holder' | 'found'
  /**
   * Les gestes du dénouement, DANS L'ORDRE, quand l'énigme est une séquence.
   *
   * Le seul morceau d'énigme que le modèle écrit : ce sont les gestes de CE
   * joueur. L'ordre affiché et les indices, eux, sont tirés à l'assemblage.
   */
  steps?: string[]
  /**
   * Le lecteur qui garde la sortie, là où la carte s'utilise (`opens_with_card`).
   * Son nom est chiffré dans le récit : le lire à la loupe ouvre son panneau.
   */
  reader?: string
}

/** Les énigmes, une par mécanique d'objet trouvé. Voir `utils/puzzles.ts`. */
export type PuzzleKind = 'frequency' | 'code' | 'sequence' | 'lock' | 'search'

/**
 * Un indice, posé sur une chose que le récit nomme.
 *
 * Il se lit en REGARDANT cette chose — `oracle.look` —, sans tour facturé.
 */
export interface PuzzleClue {
  /** Le nom de la chose, tel que le récit l'écrit en Majuscule. */
  on: string
  text: string
  /**
   * L'objet porté qui tient cet indice, quand il n'est pas dans le lieu.
   *
   * Il se lit en OBSERVANT l'objet dans l'inventaire, une fois son nom
   * déchiffré — jamais en regardant le décor. Voir `utils/puzzles.ts`.
   */
  item_id?: string
}

/**
 * L'énigme de la scène, solution comprise.
 *
 * La solution voyage jusqu'au navigateur : le jeu est solitaire, la vérifier
 * sur place est ce qui la rend gratuite.
 */
export type ScenePuzzle = { clues: PuzzleClue[] } & (
  | { kind: 'frequency'; solution: number; min: number; max: number }
  | { kind: 'code'; solution: string }
  /** `steps` dans l'ordre d'affichage ; `solution` : leurs indices dans le bon ordre. */
  | { kind: 'sequence'; steps: string[]; solution: number[] }
  /** La carte attendue, et le lieu où elle a été prise — c'est ce que dit l'indice. */
  | { kind: 'lock'; card_id: string; place: string }
  | { kind: 'search'; spots: Array<{ id: string; label: string }>; solution: string }
)

/**
 * L'objet scellé de la scène.
 *
 * Reçu au fil d'une conversation, il reste dans l'historique du chat — qui
 * tient lieu d'inventaire. On y revient avec l'augmentation pour en déchiffrer
 * le nom, puis on l'observe : ce qu'il révèle ne débloque rien, il donne de la
 * profondeur à la quête.
 */
export interface SealedObject {
  id: string
  name: string
  /** Id du PNJ qui le donne, ou « trouve ». */
  given_by: string
  /** Révélé après l'analyse. Écrit à la génération, donc gratuit à l'affichage. */
  observation: string
}

export interface SceneQuest {
  title: string
  hook: string
  objective: string
  stakes: string
  /** Ce qui attend le joueur dehors. Un horizon : introuvable dans ce bar. */
  artifact: string
  antagonist_hint: string
  why_leave: string
  /** L'équilibre rompu dans la ville, que l'objet-clé permet de rétablir. */
  restoration: string
}

export interface Interactable {
  id: string
  label: string
  verb: string
  triggers_paywall?: boolean
  /**
   * Ce qu'il devient une fois ramassé, pour un objet qu'on peut PRENDRE.
   *
   * `echange` : quelqu'un le voudra, et il quittera l'inventaire ce jour-là.
   * `recit` (défaut) : il ne vaut que par ce qu'il apprend.
   * `carte` : une carte d'accès qui n'est pas l'objet-clé. Elle n'ouvre rien
   * ici ; elle donne du choix au lecteur de fin d'acte. L'augmentation et la
   * carte que le lieu délivre, elles, arrivent en objet-clé.
   */
  item_kind?: 'echange' | 'recit' | 'carte'
  /** Sa couleur, pour une `carte` : un mot, jamais l'accent du lieu. */
  card_color?: string
  /** Cette couleur en #RRGGBB, pour la pastille de l'inventaire. */
  card_hex?: string
  /** Cette `carte` n'est qu'une moitié : l'autre se trouve dans un lieu suivant. */
  card_half?: boolean
  /**
   * Il n'existe qu'après un échange : personne ne l'a nommé avant.
   *
   * Tant qu'il n'est pas révélé, il n'est ni brouillé dans le récit, ni
   * ramassable, ni compté par l'oracle — sans quoi le jeu signalerait une
   * chose que le joueur n'a aucun moyen de voir.
   */
  hidden?: boolean
  /**
   * Ce que l'analyse révèle, pour un objet qu'on peut PRENDRE.
   *
   * Écrite à la génération de la scène, donc gratuite à l'affichage — c'est la
   * même économie que `SealedObject.observation`. Absente de tout ce qui se
   * contente d'être examiné : le décor ordinaire ne se déchiffre pas.
   */
  observation?: string
  /**
   * Le symbole de ce qu'il signifie, pour un objet qu'on peut PRENDRE.
   *
   * Des formes SVG sur une grille de 24, déjà reconstruites par le serveur.
   * Voir `utils/item-icon.ts`.
   */
  icon?: string
}

/** Le lieu de la scène : auberge, forêt, donjon... */
export interface ScenePlace {
  name: string
  sign: string
  reputation: string
}

/** Sortie brute de gpt-4o, avant tout enrichissement local. */
/**
 * Un lieu de la nuit, tel que le plan l'a inventé pour CE joueur.
 *
 * Le script n'en porte que la mécanique — ce qu'on y obtient, qui le détient.
 * Tout ce qui se voit et se lit vient d'ici, dans la langue du joueur.
 */
export interface PlannedScene {
  scene_id: string
  /** Titre de chapitre, affiché. */
  title: string
  /** Ce qu'est le lieu : devient le décor de l'image. */
  place: string
  /** Ce qu'on y voit d'abord : devient l'élément focal. */
  focal: string
  /** Le morceau du but qu'il vient y gagner. */
  step: string
  /** L'exigence mécanique, redite dans ce lieu. */
  requirement: string
  /** Le passage vers le lieu suivant : le joueur le tape. */
  exit_label: string
}

export interface NightAct {
  act_id: string
  title: string
  scenes: PlannedScene[]
}

/**
 * La quête de la nuit : la racine de toute la partie.
 *
 * Le script ne fixe plus aucun décor, seulement la mécanique : trois actes de
 * deux lieux. Le dossier d'admission — date de naissance, prénom, nom — fixe
 * le reste : un but, la tension qu'on montrera au paiement, et les six lieux.
 * L'auberge les écrit en premier ; ils voyagent ensuite par le journal et
 * chaque scène se construit sur son lieu. Ce n'est jamais l'objet à récupérer
 * dans une salle.
 */
export interface NightPlan {
  /** Ce qu'il est sorti chercher cette nuit, en une phrase. */
  goal: string
  /** Sa tension, reformulée pour lui. Hors fiction : montrée au paywall. */
  tension: string
  /** Ce vers quoi elle tend pour se détendre. Hors fiction, elle aussi. */
  release: string
  /**
   * Ce que ses nuits disent de lui : un portrait, écrit à l'auberge.
   *
   * Notes d'auteur, jamais montrées. Les scènes suivantes le reçoivent À LA
   * PLACE de la réponse du formulaire : un joueur qui retrouve ses propres
   * mots comprend qu'on l'a recopié, pas qu'on l'a lu.
   */
  portrait?: string
  /** La qualité que porte son animal, sans la bête. Même régime que `portrait`. */
  totem?: string
  acts: NightAct[]
  /** Reportés depuis la quête de l'auberge quand on la consigne : ils ne se réécrivent plus. */
  title?: string
  horizon?: string
}

export interface GeneratedScene {
  /**
   * Écrit par l'auberge seulement ; les scènes suivantes le reçoivent du
   * journal, et le serveur le leur rattache.
   */
  night?: NightPlan
  place: ScenePlace
  palette: ScenePalette
  decor: DecorElement[]
  npcs: SceneNPC[]
  quest: SceneQuest
  interactables: Interactable[]
  scene_text: string
  /**
   * Ce que voit le joueur quand la nuit se referme sans qu'il ait obtenu
   * l'objet-clé. Écrit ici, donc gratuit à l'afficher : on ne fait pas attendre
   * une génération à quelqu'un à qui on ferme la porte.
   */
  game_over: string
  /** Choisi par le modèle : qui détient l'objet, et lequel. */
  key_item: Omit<SceneKeyItem, 'exchanges_before_handover' | 'acquisition'>
  /** L'objet à analyser pour approfondir la quête. */
  sealed_object?: SealedObject
}

export interface ScenePaywallPitch {
  eyebrow: string
  generative: { eyebrow: string; title: string; text: string }
  points: Array<{ label: string; text: string }>
  closing: string
}

export interface ScenePaywall {
  gate_text: string
  cta: string
  sub_cta: string
  amount_cents: number
  currency: string
  exit_keywords: string[]
  min_turns_before_trigger: number
  pitch: ScenePaywallPitch
}

/** Réponse de la phase 1. Suffisante pour jouer, l'image est facultative. */
export interface SceneTextResponse extends GeneratedScene {
  scene_id: string
  scene_title: string
  /**
   * Le nom de la sortie de cette scène, dans la langue jouée.
   *
   * Le client le montrait en piochant `paywall.exit_keywords[0]`, ce qui
   * marchait tant que ce premier mot-clé était « le sas ». Depuis que les
   * mots-clés viennent du pack de langue, le premier est un verbe générique :
   * il fallait donc que le libellé voyage pour lui-même.
   */
  exit_label: string
  /**
   * Ce qu'il faut avoir ramassé ici, en plus de l'objet-clé, pour sortir : la
   * moitié de carte que le lieu suivant complétera.
   */
  required_item_id?: string
  /**
   * La sortie a un lecteur : la carte en main ne suffit pas, il faut s'en
   * SERVIR — « utilise la Carte Ocre pour ouvrir le passage ».
   */
  opens_with_card?: boolean
  /**
   * Ce lecteur, en cible de la loupe : déchiffré, il ouvre un panneau où l'on
   * choisit la carte à lui présenter. L'autre voie est de taper la phrase.
   */
  card_reader?: { id: string; label: string }
  /**
   * Ce lieu, tel que le plan de la nuit l'a fixé. Le client le renvoie aux
   * routes d'image et de tour : le serveur ne garde rien entre deux appels.
   */
  planned?: PlannedScene | null
  script_version: string
  /** Prompt assemblé côté serveur. Renvoyé pour information/debug uniquement :
   *  /api/scene/image le reconstruit et n'accepte jamais un prompt du client. */
  image_prompt: string
  /** Chemin d'une illustration figée, ou null si la scène doit la générer. */
  static_image: string | null
  /** Seuils de relance et de blocage, portés par le script. */
  pacing: ScenePacing
  /**
   * L'objet-clé de cette scène EST l'augmentation.
   *
   * Vrai à l'auberge seulement. Ailleurs, ramasser l'objet-clé ouvre la sortie
   * de la scène sans rien conférer de durable.
   */
  grants_augmentation: boolean
  /** Cette scène est la porte payante. Les autres s'enchaînent librement. */
  is_paywall_gate: boolean
  /** Textes de la fenêtre du bouton de l'oeil. Fixes, jamais générés. */
  eye_primer: { eyebrow: string; body: string[]; cta: string }
  /** Textes de la fenêtre qui présente l'augmentation. */
  augmentation_primer: {
    eyebrow: string
    story: string[]
    story_fallbacks: Record<string, string>
    howto_title: string
    howto_pointer: string[]
    howto_gyro: string[]
    /** La règle d'observation : la Majuscule se touche, et le décor garde ce que personne ne donne. */
    caps_note?: string
    footer: string
    cta: string
  }
  /**
   * Qui teint l'habillage : la palette de la scène, ou le magenta d'origine.
   * `palette`, héritée de `GeneratedScene`, porte les couleurs elles-mêmes.
   */
  interface_palette: 'from_scene' | 'fixed'
  /** Empreinte du script ayant produit cette scène. */
  script_fingerprint?: string
  /** Format de la mémoire du navigateur. Une scène d'un autre format est jetée. */
  memory_format?: number
  /**
   * La langue dans laquelle cette scène a été écrite.
   *
   * Elle ne sert qu'à la mémoire du navigateur : rien dans le contenu d'une
   * scène ne dit dans quelle langue elle l'a été, et sans cette marque un
   * changement de langue reservait l'ancienne au rechargement suivant.
   */
  lang?: string
  /** Thème intime du joueur. Les PNJ s'en nourrissent sans jamais le nommer. */
  theme: PlayerTheme | null
  /** Objet sans lequel le sas reste fermé. */
  key_item: SceneKeyItem | null
  /**
   * L'épreuve qui remet l'objet-clé, là où personne ne le tend.
   *
   * Absente ailleurs, et absente aussi quand la scène n'avait pas de quoi la
   * porter : le déchiffrage à la loupe suffit alors, comme avant.
   */
  puzzle?: ScenePuzzle | null
  paywall: ScenePaywall
  /** Trace de la correction d'accent appliquée côté serveur. */
  palette_audit: {
    adjusted: boolean
    original_dominant: string
    original_secondary: string
    original_accent: string
    contrast_vs_dominant: number
    contrast_vs_secondary: number
    base_contrast: number
  }
}

/** Requête de la phase 2. Volontairement pas de prompt libre. */
/** Le thème intime du joueur, résolu côté serveur depuis sa date et son nom. */
export interface PlayerTheme {
  /** Signe, ou null si la date de naissance manque. */
  sign: { key: string; name: string; element: string; tension: string; resolution: string; adventure: string } | null
  /** Nombres indiens et ce qu'ils portent. Chaque facette peut manquer. */
  numbers: {
    terrain: string | null
    destiny: string | null
    reception: string | null
    /** Ce que son nom de famille traîne, avant qu'il ait parlé. */
    heritage: string | null
  }
}

export interface ScenePacing {
  /** Échanges avec un personnage avant qu'il livre ce qu'il sait. */
  exchanges_before_steer?: number
  /** Un personnage ne répond qu'à une question : le reste glisse sur lui. */
  questions_only?: boolean
  /** Tour à partir duquel le narrateur oriente vers la sortie. */
  steer_after_turns: number
  /** Tour où la nuit se referme si le joueur n'a toujours pas ce qu'il faut. */
  failure_after_turns: number
  /** Durée de la fermeture qui s'ensuit, en heures. */
  lock_hours: number
  /** Plafond dur de tours facturés, filet de sécurité du budget. */
  hard_turn_cap: number
  autonomous_notice: string
  /** Plafond de dépense de la scène, en dollars. */
  budget_usd: number
  /** Tarifs, pour convertir des tokens en dollars côté client. */
  price_input_per_1m_usd: number
  price_output_per_1m_usd: number
}

/** Consommation réelle d'un appel, telle que la rapporte OpenAI. */
export interface TurnUsage {
  prompt_tokens: number
  completion_tokens: number
}

export interface SceneImageRequest {
  scene_id: string
  place_name: string
  palette: ScenePalette
  decor: DecorElement[]
  /** Le lieu fixé par le plan : c'est lui que l'image dessine. */
  planned?: PlannedScene | null
}

export interface SceneImageResponse {
  /** Data URI directement affichable : gpt-image-* ne renvoie que du base64. */
  image: string
  model: string
  format: string
  bytes: number
  elapsed_ms: number
}

// --- Tours de jeu -----------------------------------------------------------

/** Faits de la scène nécessaires pour narrer un tour. Envoyés par le client. */
export interface TurnContext {
  /** Échanges déjà eus avec le PNJ à qui l'on parle. Décide quand il s'ouvre. */
  npc_exchanges?: number
  player_name: string
  /**
   * L'accord grammatical, déjà formulé pour le modèle.
   *
   * Le profil ne monte pas jusqu'au tour — seuls les faits de la scène font le
   * voyage. Sans ce report, la narration de la scène accordait juste et les
   * tours, eux, repartaient au masculin.
   */
  player_agreement?: string
  place: ScenePlace
  quest: SceneQuest
  /** Ce qu'il est sorti chercher cette nuit : les personnages savent où il va. */
  night_goal?: string
  /** Le lieu fixé par le plan : sa sortie et son exigence en dépendent. */
  planned?: PlannedScene
  npcs: SceneNPC[]
  /** Reporté depuis la scène : ce que les PNJ doivent faire affleurer. */
  theme?: PlayerTheme | null
  /** Reporté depuis la scène : l'objet qui conditionne la sortie. */
  key_item?: SceneKeyItem | null
  /** Le joueur le détient-il déjà ? Décide vers quoi le narrateur oriente. */
  has_key_item?: boolean
  /** A-t-il parlé à l'informateur ? Le détenteur reste muet tant que non. */
  informed_about_item?: boolean
  /**
   * L'objet que le joueur TEND, quand le moment tiré est un don.
   *
   * `known` dit si son nom a été déchiffré : sinon personne ne peut le nommer,
   * ni le joueur qui le tend ni celui qui le prend.
   */
  offered_item?: { id: string; name: string; known: boolean } | null
  /**
   * Les identifiants de ce que le joueur porte À CET INSTANT.
   *
   * `npc.wants` a été écrit sur l'inventaire du moment de la génération : sans
   * cette liste, un personnage réclamerait encore l'objet qu'il vient de
   * recevoir.
   */
  carried_ids?: string[]
  /**
   * Le nom de l'élément caché qu'un échange de cette scène découvrirait.
   *
   * Les `hidden` sont écrits par le modèle à la génération : le serveur, qui
   * bâtit le prompt du tour, ne les a jamais vus. Sans ce report, il ne
   * pourrait pas demander au personnage de nommer ce qu'il montre.
   */
  reveal_label?: string
}

/** 'exit_nudge' : le joueur parle de sortir mais le paywall n'est pas atteint. */
export type TurnMode = 'ambient' | 'npc' | 'exit_nudge' | 'handover' | 'blocked_exit'
  /** 'give' : le joueur tend l'objet qu'un personnage attendait. */
  | 'give'
  /** 'give_refused' : il en tend un autre, dont personne ne veut. */
  | 'give_refused'

export interface TurnRequest {
  sceneId?: string
  context: TurnContext
  input: string
  /**
   * La langue de la partie.
   *
   * Jointe par le client parce que le tour n'envoie pas de profil : sans elle
   * le serveur retomberait sur le cookie, ce qui suffit presque toujours mais
   * pas quand deux onglets jouent deux langues. Le corps fait foi.
   */
  lang?: string
  /** Nombre de tours déjà joués. Décide de l'orientation vers la sortie. */
  turnCount?: number
  mode?: TurnMode
  /** Si renseigné, c'est ce PNJ qui répond au lieu du narrateur. */
  npcId?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

// --- Épilogue ---------------------------------------------------------------

/** Ce que le modèle renvoie pour la fin : un texte, une palette, une image. */
export interface GeneratedEnding {
  ending_html: string
  title: string
  /**
   * L'adieu, deux ou trois phrases.
   *
   * Le dernier texte du jeu, et le seul qui survive à la fermeture : il part
   * dans le cookie signé, pas dans la réponse, pour être encore là au prochain
   * chargement — l'épilogue, lui, ne s'affiche qu'une fois.
   */
  farewell: string
  palette: ScenePalette
  decor: DecorElement[]
}

/**
 * L'épilogue, tel qu'il arrive au client.
 *
 * `ending_html` a déjà été réduit aux quatre balises autorisées côté serveur :
 * il peut être rendu tel quel. Il se superpose à l'image du lever du jour — c'est
 * ce montage qui permet d'avoir du vrai texte français lisible, qu'aucun
 * modèle d'image ne sait produire.
 */
export interface EndingResponse {
  kind: 'ending'
  scene_id: string
  scene_title: string
  ending_html: string
  palette: ScenePalette
  decor: DecorElement[]
  interface_palette: 'from_scene'
  image_prompt: string
  static_image: null
  script_version: string
  build_id?: string
}
