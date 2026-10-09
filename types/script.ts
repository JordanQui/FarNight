// Contrat TypeScript de game/script.json.
//
// Le JSON reste la source de vérité du CONTENU : éditable à chaud, sans rebuild,
// générable, lisible par un non-développeur. Ces types en décrivent la forme,
// et utils/script-runtime.ts y ajoute le COMPORTEMENT (résolution des defaults,
// assemblage des prompts, détection des sorties).

export interface ScriptMeta {
  title: string
  language: string
  genre: string
  narrative_mode: string
  note?: string
}

export interface Progression {
  start_scene: string
  order: string[]
}

/**
 * Répartition tonale visée. Volontairement pas 60:30:10 : le Dark Deco peint
 * sur fond noir, l'ombre y prend mécaniquement plus de place. Seule la part
 * d'accent doit être tenue au chiffre près.
 */
export interface TonalRatio {
  dominant_pct: number
  secondary_pct: number
  accent_pct: number
  description: string
}

export interface ArtDirection {
  render: string
  tonal_ratio: TonalRatio
  constraints: string[]
  negative: string
  image_model: string
  image_fallback_model: string
  image_size: string
  image_quality: string
  image_format: string
  accent_reserved_for: string
  accent_note: string
  image_prompt_template: string
  portrait_prompt_template: string
}

export interface PaletteDerivation {
  instruction: string
  sources: { dominant: string[]; secondary: string[]; accent: string[] }
}

export interface NarrativeRules {
  /** Les enjeux se montrent, jamais ne se récitent. */
  stakes_rule?: string
  style: string
  instruction: string
  structure: string[]
  max_words: number
  forbidden: string[]
  /** Lexique imposé du monde. Appliqué à la génération comme aux tours. */
  vocabulary: string
  /** Les noms qui comptent s'écrivent en Majuscules de Titre. */
  naming_style: string
  /** Pourquoi le joueur est sorti ce soir. N'existe que pour le texte initial. */
  opening: string
}

export interface TurnRules {
  max_tokens: number
  max_words: number
  system_prompt_template: string
  /**
   * Comment accorder ce qu'on adresse au joueur.
   *
   * Ajoutée au prompt système dès que le dossier d'admission dit l'accord.
   * Sans elle, le modèle tranche seul — et il tranche au masculin.
   */
  agreement_rule: string
  /**
   * Ce qui se cherche dans CE lieu, en une ligne du prompt système.
   *
   * Vide par défaut : seule l'auberge le remplit (l'augmentation, chez un
   * habitué). Les autres lieux ont leurs propres personnages.
   */
  here_line?: string
  ambient_prompt: string
  npc_dialogue_prompt: string
  exit_nudge_prompt: string

  /** Tour à partir duquel le narrateur oriente activement vers la sortie. */
  steer_after_turns: number
  /** Consigne ajoutée au prompt système une fois ce seuil franchi. */
  steer_instruction: string
  /** Variante employée tant que l'objet-clé n'est pas obtenu. */
  steer_instruction_missing_item: string
  /** Variante employée tant que le joueur ignore qui détient l'objet. */
  steer_instruction_missing_informant: string
  /** Variante des scènes où l'objet ne s'obtient de personne : il est dans le lieu. */
  steer_instruction_missing_found: string
  /** Plafond dur de tours facturés, si le comptage de tokens venait à manquer. */
  hard_turn_cap: number
  /** Ce que dit la scène quand elle passe en autonomie. */
  autonomous_notice: string

  /** Faits de l'objet-clé, ajoutés au prompt système dès qu'il existe. */
  key_item_context: string
  /** Variante sans détenteur : l'objet est inscrit dans le lieu, personne ne le tend. */
  key_item_context_found: string
  /** Variante où le détenteur ne cède que contre l'offrande posée dans le décor. */
  key_item_context_offering?: string
  /** A3S1 : la chaîne secret de l'informateur → détenteur → relique. Voir `key_item.relic`. */
  key_item_context_relic?: string
  /** Ce qu'un personnage réclame, greffé à ses répliques. Interpole `{{npc_wants_hint}}`. */
  wants_rule?: string
  /** Il prend l'objet et lâche ce qu'il sait. */
  give_prompt?: string
  /** Il n'en veut pas et le rend. */
  give_refused_prompt?: string
  /** Répondre d'abord à ce que dit le joueur. Commune à tous les personnages. */
  reply_rule?: string
  /**
   * Ce qu'un personnage fait du fil qu'il partage avec le joueur.
   *
   * Chaque PNJ reçoit désormais SA propre conversation en historique — pas le
   * fil commun où sa dernière phrase était noyée entre la narration et les
   * répliques des autres. Cette règle lui dit quoi en faire : continuer plutôt
   * que recommencer, ne pas se répéter, et s'ouvrir à mesure.
   */
  thread_rule?: string
  /** Orienter vers l'objectif sans jamais le dicter. */
  steer_rule?: string
  /**
   * Comment un personnage lâche le morceau de dehors qu'il est seul à savoir.
   * Interpole `{{npc_beyond}}` ; ignorée pour un PNJ sans `beyond`.
   */
  beyond_rule?: string
  /** Ce que le personnage est dans la quête du joueur. Interpole `{{npc_role}}`. */
  role_rule?: string
  /** Premier échange d'un personnage ordinaire : il répond et renvoie UNE question. */
  npc_ask_rule?: string
  /** Échanges suivants : il commente la réponse et donne ce qu'il a d'utile. */
  npc_give_rule?: string
  /** Un personnage ne répond qu'à une question — voir `questions_only_note`. */
  questions_only?: boolean
  /** Échanges avec un personnage avant qu'il livre ce qu'il sait. */
  exchanges_before_steer?: number
  /** Ce que dit l'informateur tant qu'il jauge encore le joueur. */
  informant_warmup_prompt: string
  /** Réplique de l'informateur : il révèle qui détient l'objet. */
  informant_prompt: string
  /** Réplique du détenteur tant que le joueur n'a pas été informé : il ne lâche rien. */
  holder_locked_prompt: string
  /** Réplique du détenteur une fois le joueur informé : il amorce, il relance. */
  holder_prompt: string
  /** La même, là où il attend l'offrande : il dit ce qui lui manque, pas où c'est. */
  holder_offering_prompt?: string
  /** Greffé au don quand l'échange remet un objet. Interpole `{{reward_label}}`. */
  give_reward_item_rule: string
  /** Greffé au don quand l'échange découvre un élément caché du décor. */
  give_reveal_rule: string
  /** Greffé au don quand il n'y a rien d'autre à en tirer que ce qu'il sait. */
  give_reward_none_rule: string
  /** Greffé au don de l'offrande : il remet la carte. Interpole `{{item_name}}`, `{{item_why}}`, `{{exit_label}}`. */
  give_key_item_rule?: string
  /** Réplique du détenteur au moment où il remet l'objet. */
  handover_prompt: string
  /** Narration quand le joueur veut sortir sans l'objet. */
  blocked_exit_prompt: string
  /** La même, là où l'objet n'est sur personne : ne jamais inventer de détenteur. */
  blocked_exit_prompt_found: string
}

export interface GenerationConfig {
  model: string
  temperature: number
  max_tokens: number
  system_prompt: string
  /**
   * Ce qu'on renvoie au modèle quand sa scène est refusée.
   *
   * `{{reason}}` porte le motif du refus. Une seule reprise, et elle repart de
   * la réponse précédente : il corrige le point visé au lieu de tout réinventer.
   */
  repair_prompt: string
  output_schema: Record<string, unknown>
}

export interface ErrorFallbacks {
  narrative_error: string
  loading_message: string
  image_loading: string
  image_error: string
}

/** Bloc hérité par toutes les scènes. Chaque scène peut le surcharger partiellement. */
/**
 * Qui teint l'habillage de l'interface.
 *
 * `from_scene` reprend la palette que la scène a demandée au prompt image :
 * dominante -> fond, secondaire -> bords, accent -> néon. `fixed` garde le
 * magenta d'origine — c'est le cas de l'écran d'accueil et de l'auberge, dont
 * l'illustration est figée.
 */
export interface InterfacePalette {
  mode: 'from_scene' | 'fixed'
  /**
   * La palette du mode `fixed` : celle de l'image figée de l'auberge.
   *
   * Le rose de l'accueil et de la scène 1 est son `accent`. Il n'est donc plus
   * une couleur écrite en dur quelque part dans le CSS, mais la même donnée
   * que celle des scènes générées, lue par le même chemin.
   */
  palette?: {
    note?: string
    dominant: { hex: string; name?: string }
    secondary: { hex: string; name?: string }
    accent: { hex: string; name?: string }
  }
  note?: string
  why?: string
}

/** Comment une scène sait ce qui a précédé. Voir `utils/journal.ts`. */
export interface Continuity {
  note?: string
  /** Nombre de scènes retenues. Au-delà, les plus anciennes tombent. */
  max_entries: number
  entry_fields: string[]
  /** Interpole `{{journal}}`. */
  prompt: string
  /** Ce qu'on écrit à la place quand rien ne précède. */
  empty: string
}

export interface ScriptDefaults {
  continuity: Continuity
  /** Jamais d'agressivité envers le joueur, toujours une issue : injecté dans chaque prompt système. */
  player_care: { note?: string; instruction: string }
  /** Ce que les personnages ont le droit de dire d'une énigme, par nature. */
  puzzles: { note?: string; turn_rules: Record<import('~/types/scene').PuzzleKind, string>; scene_rule: string }
  /** Ce que le récit vise à restaurer, sous la quête apparente. */
  deep_theme: { note?: string; instruction: string }
  /**
   * Le moment, le film, l'animal : ce que la nuit fait de chacun. `instruction`
   * vaut pour les scènes, `ending` pour l'épilogue.
   */
  touchstones: { note?: string; instruction: string; ending: string }
  /** Ce que le modèle écrit pour la nuit qui se referme sans objet. */
  game_over: { note?: string; instruction: string }
  /** Cartes et serrures : la couleur dit laquelle présenter. */
  locks: { note?: string; instruction: string }
  /** La carte de plus à ramasser, dans les lieux qui précèdent le lecteur. */
  spare_card: { note?: string; instruction: string }
  /**
   * La carte de plus devenue première moitié, là où `card_half` le demande ;
   * `instruction_second` pose l'autre là où l'objet-clé la complète.
   */
  card_half: { note?: string; instruction: string; instruction_second: string }
  /** L'objet que le détenteur attend pour céder la carte. Voir `key_item.offering`. */
  offering?: { note?: string; instruction: string }
  /** Le pictogramme que chaque objet porté reçoit à sa génération. */
  item_icons: { note?: string; instruction: string }
  /** La fenêtre du bouton de l'oeil. Texte fixe : ce n'est pas de la fiction. */
  eye_primer: { note?: string; eyebrow: string; body: string[]; cta: string }
  /** La fenêtre qui présente l'augmentation, à la réception. */
  augmentation_primer: {
    note?: string
    eyebrow: string
    story: string[]
    story_fallbacks: Record<string, string>
    howto_title: string
    howto_pointer: string[]
    howto_gyro: string[]
    /** La Majuscule se touche, et le décor garde ce que personne ne donne. */
    caps_note?: string
    footer: string
    cta: string
  }
  /** Le schéma des champs de quête, commun à toutes les scènes. */
  quest: { note?: string; structure: Record<string, string> }
  /**
   * La quête de la nuit : le but tiré du dossier, le plan qui dit ce que chaque
   * lieu est pour ce joueur, et ce qui s'en déduit dans chaque scène.
   */
  night: {
    note?: string
    instruction: string
    /** Les ingrédients du but, posés depuis le signe et les nombres. */
    calculus: { instruction: string; fallback: string }
    plan: string
    fixed: string
    derives: string
    /** Portrait et totem : ce que l'auberge lit du dossier, pour toute la nuit. */
    reading: string
    /** La même lecture, rendue aux scènes suivantes. Interpole `{{portrait}}`, `{{totem}}`. */
    reading_fixed: string
  }
  /** L'objet scellé, hérité par les scènes qui n'en déclarent pas. */
  sealed_object: { note?: string; instruction: string }
  /** Ce qu'un personnage réclame de ce que le joueur porte, et ce qu'il en donne. */
  exchange: { note?: string; instruction: string }
  /** Ce que le joueur porte en arrivant, et ce que la scène doit en faire. */
  inventory: {
    note?: string
    prompt: string
    empty: string
    unread: string
    /** Cadrage propre à l'épilogue : on relit, on ne résout plus. */
    ending_prompt: string
    ending_empty: string
  }
  /** Comment une scène distribue ses personnages face à la tension. */
  cast: { note?: string; instruction: string }
  /** Comment l'exigence d'une scène devient l'objectif de CE joueur. */
  objective_derivation: { note?: string; instruction: string }
  art_direction: ArtDirection
  palette_derivation: PaletteDerivation
  interface_palette: InterfacePalette
  narrative: NarrativeRules
  turn: TurnRules
  generation: GenerationConfig
  error_fallbacks: ErrorFallbacks
}

export type VisualWeight = 'dominant' | 'secondary' | 'accent' | 'none'

export interface DecorSlot {
  id: string
  role: string
  /** Chemin pointant dans le profil joueur, ou "static". */
  source: string
  visual_weight: VisualWeight
  required?: boolean
}

export interface AlwaysIncludeInteractable {
  id: string
  label: string
  verb: string
  triggers_paywall?: boolean
}

export interface SceneExit {
  id: string
  label: string
  keywords: string[]
  min_turns_before_trigger: number
  /** Id d'une autre scène, ou "PAYWALL". */
  leads_to: string
}

/**
 * Comment l'objet-clé d'une scène s'obtient.
 *
 * `informant_then_holder` : trois rôles — celui qui accueille, celui qui sait,
 * celui qui garde. C'est le motif de l'auberge, celui qui fait parler à tout
 * le monde. `holder` : un seul personnage l'a, sans intermédiaire. `found` :
 * personne ne l'a, il est dans le décor et il faut savoir le lire.
 */
export type KeyItemAcquisition = 'informant_then_holder' | 'holder' | 'found'

/**
 * Ce que la salle apprend au joueur, réparti entre ses habitants.
 *
 * L'auberge est le seul endroit du jeu où l'on s'assoit et où l'on parle :
 * après elle on avance, et ce que le joueur en a compris est tout ce qu'il
 * emporte. Chaque personnage porte UN morceau de ce qui attend dehors, dans
 * l'ordre de la liste — mis bout à bout ils disent ce qu'il y a à faire, pris
 * un par un aucun ne suffit. C'est ce qui oblige à parler à tout le monde.
 */
export interface SceneKnowledge {
  note?: string
  instruction: string
  fragments: KnowledgeFragment[]
}

export interface KnowledgeFragment {
  /** Le rang et la position du personnage : « 3 — l'habitué qui s'y est brisé ». */
  npc: string
  /** L'acte auquel ce morceau se rapporte. Vérifié contre `acts`. */
  act?: string
  /** Ce qu'il sait, et lui seul. */
  holds: string
  /** Comment ça sort de sa bouche : sa position face à la tension, en acte. */
  told_as: string
}

export interface SceneScript {
  id: string
  title: string
  order: number
  is_free: boolean
  is_paywall_gate: boolean
  image_setting: string
  focal_element: string
  /**
   * Ce qu'on obtient dans ce lieu, et comment. C'est tout ce que le script
   * sait d'un lieu de la nuit : le plan de l'auberge invente le reste.
   */
  mechanic?: string
  /** Illustration figée, servie depuis public/. Court-circuite la génération. */
  static_image?: string
  naming: { instruction: string; sources: string[] }
  decor_slots: DecorSlot[]
  npcs: { count: number; instruction: string; source: string; knowledge?: SceneKnowledge }
  quest: { instruction: string; source: string; structure: Record<string, string> }
  interactables: {
    instruction: string
    always_include: AlwaysIncludeInteractable[]
    /** Ce lieu pose une carte de plus parmi les objets à prendre. */
    spare_card?: boolean
    /**
     * Cette carte de plus est la première moitié de la carte d'un lieu suivant.
     * On ne quitte pas le lieu sans l'avoir prise. Voir `defaults.card_half`.
     */
    card_half?: boolean
  }
  exits: SceneExit[]
  /** Règle de conception de l'augmentation sans laquelle on ne peut pas sortir. */
  key_item: {
    instruction: string
    exchanges_before_handover: number
    /** Défaut : `informant_then_holder`, le motif de l'auberge. */
    acquisition?: KeyItemAcquisition
    /** La posture du personnage qui détient l'objet, s'il y en a un. */
    holder_stance?: string
    /** La posture de celui qui met sur la piste, dans un motif à trois rôles. */
    informant_stance?: string
    /**
     * L'énigme qui remet l'objet, quand il se trouve. Voir `utils/puzzles.ts`.
     * Sans elle, le déchiffrer à la loupe suffit.
     */
    puzzle?: import('~/types/scene').PuzzleKind
    /**
     * Le joueur en porte déjà la moitié, ramassée plus tôt : la seconde est
     * posée ici, et les ramasser l'une après l'autre fait cette carte, qui en
     * reprend le nom et la couleur et les remplace en poche.
     */
    completes_half?: boolean
    /**
     * Le détenteur ne cède la carte que contre une chose posée dans le décor,
     * écho poétique de l'objet auquel le joueur tient. Voir `defaults.offering`.
     */
    offering?: boolean
    /**
     * A3S1 : l'informateur révèle un secret sur le détenteur ; le joueur lui
     * en parle, et il tend alors une relique chiffrée, qu'il ne sait pas lire
     * lui-même.
     */
    relic?: boolean
  }
  /** L'acte auquel la scène appartient. Voir `acts` à la racine du script. */
  act?: string
  /** `ending` : l'épilogue, qui ne suit pas le schéma des autres scènes. */
  kind?: 'scene' | 'ending'
  /** Cadrage du thème propre à l'épilogue : le point d'arrivée, pas la construction. */
  theme_frame?: { note?: string; instruction: string }
  /** La lecture finale : le seul moment du jeu qui parle au joueur en clair. */
  counsel?: { note?: string; registers: string[]; instruction: string }
  is_final?: boolean
  /**
   * Ce qui gouverne la scène côté joueur.
   *
   * `facet` désigne l'un des trois nombres — ce que la nuit oppose, forme de
   * l'objectif, accueil du monde — et `axis` dit où en est le joueur entre sa
   * tension et sa résolution. Un acte entier partage sa facette.
   */
  theme_focus?: {
    facet: 'terrain' | 'destiny' | 'reception'
    facet_label: string
    axis: string
    step: number
  }
  /** Les positions face à la tension, dans l'ordre des personnages. */
  cast_stances?: Array<{ posture: string; means: string }>
  /** Règle de conception de l'objet scellé, à analyser. */
  /**
   * Le second objet, à déchiffrer pour approfondir la quête.
   *
   * Propre à l'auberge pour l'instant : les scènes suivantes s'en passent, et
   * le bloc du prompt disparaît quand il n'est pas déclaré.
   */
  sealed_object?: { instruction: string }
  /** Ce qu'il faut accomplir pour passer à la scène suivante. */
  objective: {
    note?: string
    kind: string
    /** L'exigence mécanique de la scène. Invariable : c'est la structure de l'arc. */
    requirement?: string
    statement?: string
  }

  /** Surcharges optionnelles des defaults, scène par scène. */
  art_direction?: Partial<ArtDirection>
  palette_derivation?: Partial<PaletteDerivation>
  interface_palette?: Partial<InterfacePalette>
  narrative?: Partial<NarrativeRules>
  turn?: Partial<TurnRules>
  generation?: Partial<GenerationConfig>
}

export interface ZodiacSignScript {
  name: string
  element: string
  /** Le conflit intérieur que le signe inflige dans le rapport à la société. */
  tension: string
  /** À quoi ressemble sa résolution, en acte. */
  resolution: string
  /**
   * La grande aventure que le signe réclame, pour la vie du joueur lui-même.
   * C'est la matière de `night.goal` : jamais un service rendu à un proche.
   */
  adventure: string
}

export interface ZodiacScript {
  note?: string
  generation_instruction: string
  turn_instruction: string
  /** Comment lire le thème natal calculé par utils/natal-chart.ts. */
  chart_instruction?: string
  signs: Record<string, ZodiacSignScript>
}

export interface NumerologyNumberScript {
  /** Ce que la nuit oppose au joueur — porté par le moolank. Le terrain,
   * jamais sa conduite : le joueur reste libre de ses gestes. */
  terrain: string
  /** Forme concrète de l'objectif — porté par le bhagyank. */
  destiny: string
  /** Façon dont le monde reçoit le joueur — porté par le namank du prénom. */
  reception: string
  /** Ce que son nom traîne — porté par le namank du nom complet. */
  heritage: string
}

export interface NumerologyScript {
  note?: string
  generation_instruction: string
  numbers: Record<string, NumerologyNumberScript>
}

/** Tarifs et plafond de dépense. Le budget est arbitré, jamais facturé. */
export interface PricingConfig {
  note?: string
  input_per_1m_usd: number
  output_per_1m_usd: number
  image_per_call_usd: number
  /** Taille des images sur la facture qui a fixé `image_per_call_usd`. */
  image_size_billed?: string
  scene_budget_usd: number
}

/**
 * La fermeture de la ville.
 *
 * À ne pas confondre avec le quota : celui-ci borne la DÉPENSE sur la fenêtre,
 * celle-là borne le TEMPS. Elle s'applique toujours — quotas éteints et
 * développement compris —, parce que c'est une règle de jeu et non une borne
 * comptable.
 */
export interface LockConfig {
  note?: string
  /** Tours dans une même scène au-delà desquels la nuit se referme. */
  turns_per_scene: number
  /** Durée de la fermeture après une scène qui n'a mené nulle part. */
  hours: number
  /** Durée de la fermeture après l'épilogue. L'histoire ne se rejoue pas. */
  completed_days: number
  message: string
  completed_message: string
}

/** Quota par session, contre l'abus par rechargement. */
export interface LimitsConfig {
  note?: string
  lock: LockConfig
  /** Interrupteur global. À false, aucune requête n'est décomptée ni refusée. */
  enabled: boolean
  window_hours: number
  scenes_per_session: number
  turns_per_session: number
  images_per_session: number
  messages: { scenes: string; turns: string; images: string }
  /** Quota ouvert par le paiement, sur une fenêtre bien plus large. */
  paid: {
    window_days: number
    scenes_per_window: number
    turns_per_window: number
    images_per_window: number
    messages: { scenes: string; turns: string; images: string }
  }
}

/** Argumentaire affiché à la sortie : ce que le jeu fait, et pourquoi continuer. */
export interface PaywallPitch {
  eyebrow: string
  /** Ce qui rend la suite inédite : tout y est généré pour ce joueur. Sans variable. */
  generative: { eyebrow: string; title: string; text: string }
  points: Array<{ label: string; text: string }>
  closing: string
}

/**
 * Hypothèses de prévision.
 *
 * La forme de la nuit (scènes, gratuité, images) et la taille des prompts n'y
 * figurent pas : /api/admin/economics les lit dans le script et les mesure.
 */
export interface EconomicsConfig {
  note?: string
  eur_usd: number
  conversion_rate_pct: number
  /** Ce que l'IA d'un acheteur ne doit jamais dépasser, quota épuisé compris. */
  ai_budget_per_sale_eur?: number
  /** TVA comprise dans le prix affiché. 0 en franchise en base. */
  vat: { note?: string; pct: number }
  payment: { note?: string; fee_pct: number; fee_fixed_eur: number }
  play: {
    note?: string
    /** Tours joués en moyenne par scène — le verrou en fixe le plafond. */
    turns_per_scene: number
    /** Tours joués à l'auberge par qui ne paie pas. */
    free_visitor_turns: number
    /** Part des scènes refusées par la validation, donc générées deux fois. */
    repair_rate_pct: number
  }
  tokens: {
    note?: string
    opening_output: number
    scene_output: number
    ending_output: number
    turn_output: number
    /** Le fil du personnage renvoyé avec chaque tour. */
    turn_history_input: number
  }
  hosting: {
    note?: string
    plan_monthly_usd: number
    /** Crédit d'usage inclus dans le forfait, sur lequel l'Analytics s'impute d'abord. */
    usage_credit_usd: number
    analytics_per_1k_events_usd: number
    events_per_visit: number
  }
}

/** Syllabaire construit : chaque syllabe porte un sens, les noms se composent. */
export interface OnomasticsConfig {
  note?: string
  instruction: string
  /** Syllabe initiale : ce que le personnage porte. */
  matiere: Record<string, string>
  /** Syllabe finale : ce qu'il en fait. */
  posture: Record<string, string>
}

export interface PaywallConfig {
  gate_text: string
  cta: string
  sub_cta: string
  amount_cents: number
  currency: string
  pitch: PaywallPitch
}

/**
 * Un acte : ce qu'il met à l'épreuve, et ses lieux dans l'ordre.
 *
 * Il ne porte aucun décor. Son titre du script n'est qu'un repli : celui que
 * voit le joueur vient du plan de la nuit, écrit par l'auberge.
 */
export interface ScriptAct {
  id: string
  title: string
  scenes: string[]
  arc: string
  ends_on?: string
}

export interface Script {
  id: string
  version: string
  meta: ScriptMeta
  progression: Progression
  acts: ScriptAct[]
  defaults: ScriptDefaults
  scenes: SceneScript[]
  paywall: PaywallConfig
  zodiac: ZodiacScript
  numerology: NumerologyScript
  pricing: PricingConfig
  limits: LimitsConfig
  onomastics: OnomasticsConfig
  economics: EconomicsConfig
}

/** Une scène dont les defaults ont été résolus : plus aucun champ optionnel. */
export interface ResolvedScene extends SceneScript {
  art_direction: ArtDirection
  palette_derivation: PaletteDerivation
  interface_palette: InterfacePalette
  narrative: NarrativeRules
  turn: TurnRules
  generation: GenerationConfig
  error_fallbacks: ErrorFallbacks
}
