import scriptJson from '../game/script.json'
import type {
  Script,
  SceneScript,
  ResolvedScene,
  SceneExit,
} from '~/types/script'
import type { NightPlan, PlannedScene, PlayerTheme, SceneKeyItem } from '~/types/scene'
import type {
  GeneratedScene,
  SceneTextResponse,
  ScenePalette,
  DecorElement,
  TurnContext,
  SceneNPC,
  TurnMode,
} from '~/types/scene'
import type { UserProfile } from '~/types/user'
import { interpolate } from '~/utils/prompt-builder'
import { matchesKeyword } from '~/utils/text-match'
import { deterministicPaletteHexes, enforceAccentVisibility } from '~/utils/palette'
import { enforceNameCaps, fold } from '~/utils/naming'
import { isTakeable } from '~/utils/interactables'
import { sanitizeHtml } from '~/utils/sanitize-html'
import { sanitizeItemIcon } from '~/utils/item-icon'
import { nightOf, renderJournal, type JournalEntry, type CarriedItem } from '~/utils/journal'
import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { agreementFor, overlayValue, pack } from '~/utils/languages'
import { zodiacKey } from '~/utils/zodiac'
import { numerologyOf } from '~/utils/numerology'
import { drawPuzzle, surfacesOf } from '~/utils/puzzles'
import { profileFromAdmission, sampleAdmissionForm } from '~/utils/admission'

// Les JSON sont importés, pas lus sur le disque : en serverless (Vercel) le
// process ne voit que le bundle, jamais l'arborescence du repo. L'import les
// inline dans le build, donc ils sont toujours là.
const script = scriptJson as unknown as Script

/**
 * Le dossier type, tiré des réponses de game/admission.json par le même
 * chemin que le formulaire : il ne peut pas porter un champ que le formulaire
 * ne produit pas. Recalculé à chaque appel, pour que l'âge suive la date.
 */
export function loadUserFixture(): Promise<UserProfile> {
  return Promise.resolve(profileFromAdmission(sampleAdmissionForm()))
}

/**
 * Aplatit le profil en un bloc lisible par le modèle.
 *
 * Reste EN FRANÇAIS quelle que soit la langue jouée : c'est une consigne, pas
 * du texte de jeu, et elle voisine avec tout le reste du prompt, français lui
 * aussi. Seule la ligne d'accord change de langue — elle est faite d'exemples
 * que le modèle doit reproduire tels quels.
 */
export function describeUser(
  user: UserProfile,
  /**
   * La lecture de l'auberge existe : la réponse sur ses nuits et son animal
   * ne voyagent plus en clair, seul ce qu'on en a lu passe. Voir
   * `defaults.night.reading`.
   */
  read = false,
): string {
  const lines: string[] = []

  lines.push(`Nom : ${user.identity.name}`)
  // Le prénom à part : c'est par lui que les personnages l'appellent.
  if (user.identity.first_name) lines.push(`Prénom, celui qu'on lui donne : ${user.identity.first_name}`)
  if (user.identity.age) lines.push(`Âge : ${user.identity.age} ans`)
  const agreement = agreementFor(user.language, user.identity.agreement)
  if (agreement) lines.push(`Accord : ${agreement}`)

  const { hometown, current_location } = user.origin
  if (hometown) {
    const traits = hometown.traits?.length ? ` — ${hometown.traits.join(', ')}` : ''
    lines.push(`Ville d'origine : ${hometown.name}${traits}`)
  }
  if (current_location) {
    const traits = current_location.traits?.length ? ` — ${current_location.traits.join(', ')}` : ''
    lines.push(`Ville actuelle : ${current_location.name}${traits}`)
  }

  if (user.trajectory.turning_points.length) {
    lines.push(`Tournants de vie :\n${user.trajectory.turning_points.map(t => `  - ${t}`).join('\n')}`)
  }

  // Les trois repères. Ce qu'ils font dans la nuit est écrit une fois, dans
  // `defaults.touchstones` ; ici ne voyage que l'interdit propre à chacun, collé
  // à la donnée comme pour le morceau — c'est là qu'il tient le mieux.
  const marks = user.touchstones
  if (marks?.moment) lines.push(`Un moment auquel il tient : ${marks.moment}`)
  if (marks?.fear_film) {
    lines.push(
      `Le film qui lui a fait le plus peur : « ${marks.fear_film} » — n'en cite jamais le titre, `
      + `ni un personnage, ni une réplique, ni une scène connue. N'en garde que la MANIÈRE dont il fait peur.`)
  }
  if (marks?.animal && !read) {
    lines.push(
      `Son animal préféré : ${marks.animal} — à LIRE pour sa signification (voir SA LECTURE), `
      + `jamais à montrer en clair.`)
  }

  const imprints = user.imprints
  if (imprints?.keepsake) lines.push(`Objet auquel il tient : ${imprints.keepsake}`)
  if (imprints?.refuge) lines.push(`Où il va quand ça ne va pas : ${imprints.refuge}`)
  if (imprints?.ally) lines.push(`Quelqu'un qui compte pour lui : ${imprints.ally}`)
  // Ce n'est pas une peur — la peur, c'est le film. On le dit ici, collé à la
  // donnée, parce que le modèle fond volontiers les deux en une seule menace.
  if (imprints?.aversion) {
    lines.push(`Ce qu'il ne supporte pas : ${imprints.aversion} — pas une peur : ce qui le fait bouillir.`)
  }

  // Le morceau a un rôle dans la nuit — haché dehors, entier au dernier lieu —,
  // écrit dans `defaults.touchstones`. Ici ne voyage que l'interdit : le modèle
  // connaît les paroles des titres un peu connus et ne doit pas les rendre, et
  // la consigne tient mieux collée à la donnée que perdue plus loin.
  if (user.anthem) {
    const by = user.anthem.artist ? ` de ${user.anthem.artist}` : ''
    lines.push(
      `Un morceau qui compte pour lui : « ${user.anthem.title} »${by} — n'en cite jamais un vers, `
      + `ni le titre, ni l'artiste. On l'entend, on ne le lit pas : un tempo, une voix, un instrument.`)
  }

  // Les nuits sans sommeil, et le rêve. Le joueur s'y déclare à la première
  // personne : on garde ses mots tels quels plutôt que de les retourner à la
  // troisième, parce que c'est la seule partie du dossier qu'il a écrite en
  // entier et que sa formulation vaut autant que son contenu.
  // Ses nuits se LISENT : l'auberge en tire un portrait (voir
  // `defaults.night.reading`), et c'est ce portrait qui voyage ensuite. Un
  // joueur qui retrouve ses propres mots comprend qu'on l'a recopié.
  const nights = user.nights
  if (nights?.awake_note && !read) {
    lines.push(
      `Les nuits où il ne dort pas : ${nights.awake_note} — un symptôme à LIRE (voir SA LECTURE), `
      + `jamais une anecdote à replacer : aucun de ces mots ne revient dans le texte.`)
  }
  if (nights?.dream_note) lines.push(`Le rêve qui lui revient : ${nights.dream_note}`)

  if (user.misc_facts?.length) lines.push(`Divers : ${user.misc_facts.join(' ; ')}`)

  // Le principe de tout le dossier, dit une fois : il nourrit une trame
  // symbolique, il ne se recrache pas. Retrouver ses mots de but en blanc,
  // c'est découvrir qu'on a été recopié.
  lines.push(
    'CE DOSSIER SE LIT, IL NE SE RECOPIE PAS : chaque réponse est transposée, symbolisée, '
    + 'rendue en situation — aucune de ses formules ne revient telle quelle dans le texte.')

  return lines.join('\n')
}

/**
 * Résout le thème intime du joueur : signe et nombres.
 *
 * Les calculs sont dans utils/zodiac.ts et utils/numerology.ts, les textes dans
 * script.json. Cette fonction ne fait que les apparier — et tolère qu'il manque
 * la date ou le nom : chaque facette retombe indépendamment sur null.
 */
export function resolveTheme(user: UserProfile, script: Script): PlayerTheme | null {
  const key = zodiacKey(user.identity.birthday)
  const entry = key ? script.zodiac?.signs?.[key] : undefined
  // Le namank se calcule sur le PRÉNOM : la numérologie indienne pèse le nom
  // par lequel on est appelé, pas l'état civil complet. Le nom entier reste le
  // repli des vieux profils, qui n'avaient qu'un champ — et n'ont alors pas
  // d'héritage, faute de savoir où finit le prénom.
  // Chaque moitié se pèse dans son écriture (chaldéen, abjad, translittéré) ;
  // un nom en idéogrammes passe par la forme latine déclarée au formulaire.
  const { first_name, last_name, name, first_name_latin, last_name_latin } = user.identity
  const numbers = numerologyOf(
    user.identity.birthday,
    first_name || name,
    first_name ? last_name : undefined,
    { first: first_name_latin, last: last_name_latin },
  )
  const table = script.numerology?.numbers ?? {}

  const facet = (
    n: number | null | undefined,
    field: 'terrain' | 'destiny' | 'reception' | 'heritage',
  ) => (n ? table[String(n)]?.[field] ?? null : null)

  const sign = key && entry ? { key, ...entry } : null
  const resolved = {
    terrain: facet(numbers?.moolank, 'terrain'),
    destiny: facet(numbers?.bhagyank, 'destiny'),
    reception: facet(numbers?.namank, 'reception'),
    heritage: facet(numbers?.full_namank, 'heritage'),
  }

  const hasNumbers = Boolean(
    resolved.terrain || resolved.destiny || resolved.reception || resolved.heritage)
  if (!sign && !hasNumbers) return null
  return { sign, numbers: resolved }
}

/** `npc_id` d'un objet qui n'est sur personne : il est dans le décor. */
export const FOUND_ITEM_ID = 'trouve'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * La forme exigée du nom de l'augmentation : deux ou trois mots soudés, chacun
 * à majuscule, lettres non accentuées uniquement — « FocaleBraise ».
 *
 * Elle ne vaut QUE pour l'augmentation : ailleurs l'objet-clé est une carte
 * colorée, et « La Carte Ambre » doit rester lisible telle quelle.
 */
const AUGMENTATION_NAME_RE = /^[A-Z][a-z]+(?:[A-Z][a-z]+){1,2}$/

/**
 * La même exigence dans les écritures sans casse, où « soudé à majuscules »
 * ne veut rien dire. Le chinois et le japonais soudent naturellement : un
 * composé de deux à huit signes, sans espace ni ponctuation. L'arabe : un ou
 * deux mots, rien d'autre que des lettres arabes. Le gras fait le reste.
 */
const DENSE_AUGMENTATION_NAME_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,8}$/u
const ARABIC_AUGMENTATION_NAME_RE = /^\p{Script=Arabic}{2,}(?: \p{Script=Arabic}{2,})?$/u

/**
 * Une scène du script, defaults résolus, augmentée de son comportement.
 * Le contenu reste dans le JSON ; cette classe ne fait que l'exploiter.
 */
export class SceneRuntime {
  constructor(
    readonly scene: ResolvedScene,
    private readonly script: Script,
    /**
     * La langue de cette partie.
     *
     * Portée par la scène et non passée à chaque appel : tout ce que cette
     * classe fabrique en dépend — les prompts, les libellés, les replis — et un
     * paramètre de plus sur douze méthodes se serait oublié quelque part.
     */
    readonly lang: LangCode = DEFAULT_LANG,
    /** Le lieu fixé par le plan de la nuit, quand cette instance lui est propre. */
    private readonly plan: PlannedScene | null = null,
  ) {}

  /**
   * Cette scène, telle que le plan de la nuit l'a fixée pour ce joueur.
   *
   * Le script ne porte que la mécanique d'un lieu ; son décor, son titre, sa
   * sortie et son exigence viennent du plan. Une instance À PART : celle du
   * script est partagée entre toutes les parties, on n'y touche jamais.
   */
  withPlan(planned?: PlannedScene | null): SceneRuntime {
    if (!planned) return this
    const s = this.scene
    return new SceneRuntime({
      ...s,
      image_setting: planned.place || s.image_setting,
      focal_element: planned.focal || s.focal_element,
      exits: s.exits.map((e, i) => (i === 0 && planned.exit_label ? { ...e, label: planned.exit_label } : e)),
      objective: { ...s.objective, requirement: planned.requirement || s.objective.requirement },
    }, this.script, this.lang, planned)
  }

  /** La scène qui écrit la quête de la nuit. */
  private get isStart(): boolean {
    return this.scene.id === this.script.progression.start_scene
  }

  /** Les lieux que le plan doit couvrir : ceux des actes, épilogue exclu. */
  private get planIds(): string[] {
    return this.script.acts
      .flatMap(a => a.scenes)
      .filter(id => this.script.scenes.find(sc => sc.id === id)?.kind !== 'ending')
  }

  /** Le pack de la langue jouée. */
  private get pack() { return pack(this.lang) }

  /**
   * L'objet-clé de cette scène se trouve-t-il, au lieu de se recevoir ?
   *
   * Trois scènes sur dix n'ont AUCUN détenteur : la fréquence est sur le
   * terminal, le code sur une plaque, la séquence sur la console. Tous les
   * prompts du tour parlaient pourtant d'un porteur — et à défaut d'en trouver
   * un, ils écrivaient « un habitué », ce qui envoyait le joueur mendier un
   * objet que personne n'a jamais eu.
   */
  private get itemIsFound(): boolean {
    return (this.scene.key_item?.acquisition ?? 'informant_then_holder') === 'found'
  }

  /**
   * L'objet-clé est-il une carte d'accès ? Tout lieu qui fait avancer en donne
   * une, sauf ceux dont l'objet est une valeur — fréquence, code, séquence.
   */
  private get keyItemIsCard(): boolean {
    const puzzle = this.scene.key_item?.puzzle
    return this.scene.objective?.kind === 'advance'
      && puzzle !== 'frequency' && puzzle !== 'code' && puzzle !== 'sequence'
  }

  /**
   * Les verbes que `isTakeable` reconnaîtra, dits au modèle.
   *
   * Le client décide qu'un objet se ramasse en comparant son `verb` à la liste
   * du pack — et c'est de là que vient le bouton « Ramasser ». Le modèle écrit
   * dans la langue jouée : sans cette ligne il choisit un synonyme hors liste,
   * l'objet reste dans le décor sans que rien ne le prenne, et la seule voie
   * qui ne passe pas par un personnage se referme en silence.
   */
  private get takeVerbs(): string {
    return this.pack.input.take.slice(0, 3).map(v => `« ${v} »`).join(', ')
  }

  /**
   * Le bloc qui impose la langue de sortie, en tête de chaque prompt.
   *
   * Il est écrit DANS la langue visée, au milieu de consignes françaises. Ce
   * contraste est délibéré : c'est le signal le plus net qu'on puisse donner à
   * un modèle sur la langue attendue, plus net qu'une consigne française qui
   * la nommerait. Il rappelle aussi la façon d'interpeller le joueur, que
   * toutes les langues ne tranchent pas au même endroit.
   */
  private get languageBlock(): string {
    const g = this.pack.generation
    return `LANGUE DE SORTIE — ${g.name_fr}\n${g.directive}\n${g.address}`
  }

  /** Les variables de langue, communes à toutes les interpolations. */
  private get langVars(): Record<string, string> {
    return {
      language: this.pack.generation.name_fr,
      // « Français parlé, sec » devient « anglais parlé, sec » : la consigne
      // reste française, seul le nom de la langue bouge.
      language_spoken: `${this.pack.generation.name_fr} parlé`,
    }
  }

  /**
   * Le prompt système de la génération, langue imposée.
   *
   * Le script le porte encore avec un `{{language}}` : c'est ici qu'il se
   * remplit, et nulle part ailleurs — l'endpoint le lisait cru.
   */
  get systemPrompt(): string {
    return `${interpolate(this.scene.generation.system_prompt, this.langVars)}\n\n${this.playerCareBlock}\n\n${this.languageBlock}`
  }

  /**
   * Jamais d'agressivité envers le joueur, toujours une issue.
   *
   * Une règle absolue, donc dans chaque prompt système — génération, tours,
   * épilogue — et non scène par scène : un personnage bourru ne doit pas
   * pouvoir la faire oublier.
   */
  private get playerCareBlock(): string {
    return this.script.defaults.player_care.instruction
  }

  /**
   * Le lexique imposé, dans la langue jouée.
   *
   * Chaque langue a son mot de sortie — sas, airlock, esclusa, Schleuse — et
   * ses propres faux amis médiévaux. Le pack français laisse le champ vide :
   * `game/script.json` porte déjà sa version, et la dupliquer ferait deux
   * vérités.
   */
  private get vocabulary(): string {
    return this.pack.generation.vocabulary || this.scene.narrative.vocabulary
  }

  /**
   * Une valeur d'affichage, surchargée par la langue quand elle l'est.
   *
   * Le script reste la source ; le pack ne fait que passer devant. Le français
   * ne surcharge rien, et retombe donc toujours ici sur `game/script.json`.
   */
  private localized<T>(path: string, fallback: T): T {
    return overlayValue<T>(this.lang, path) ?? fallback
  }

  /**
   * La règle de nommage, plus ce que la langue en fait.
   *
   * `caps_note` est la DERNIÈRE chose que le modèle lit sur le sujet, et c'est
   * voulu : en allemand elle contredit la règle générale, puisque tous les
   * noms communs y portent déjà une majuscule.
   */
  private get namingStyle(): string {
    return `${this.scene.narrative.naming_style}\n${this.pack.generation.caps_note}`
  }

  get id() { return this.scene.id }
  /**
   * Le titre affiché de la scène, dans la langue jouée.
   *
   * Il part aussi dans les prompts (`{{scene_title}}`) : servir « Le Comptoir »
   * à une génération anglaise donnerait au modèle une amorce dans la mauvaise
   * langue, juste là où il choisit son ton.
   */
  get title() {
    // Le plan est déjà dans la langue du joueur : il passe devant le pack.
    return this.plan?.title
      || (overlayValue<string>(this.lang, `scene_titles.${this.scene.id}`) ?? this.scene.title)
  }
  get generation() { return this.scene.generation }
  get artDirection() { return this.scene.art_direction }
  get turn() { return this.scene.turn }
  /** Les replis d'erreur, surchargés par le pack de langue. */
  get fallbacks() {
    return { ...this.scene.error_fallbacks, ...overlayValue<Record<string, string>>(this.lang, 'error_fallbacks') }
  }
  /** Illustration figée de la scène, ou null si elle doit être générée. */
  get staticImage() { return this.scene.static_image ?? null }
  /** `ending` : cette scène clôt la partie et ne suit pas le schéma des autres. */
  get kind() { return this.scene.kind ?? 'scene' }
  /** Seuils de relance et de blocage, envoyés au client avec la scène. */
  get pacing() {
    return {
      steer_after_turns: this.scene.turn.steer_after_turns,
      // Échanges avec un personnage avant qu'il livre ce qu'il sait.
      exchanges_before_steer: this.scene.turn.exchanges_before_steer ?? 2,
      // Le tour où la nuit se referme. Une seule source : le bloc `limits.lock`,
      // celui-là même que le serveur applique. Deux chiffres se seraient
      // désynchronisés, et le client aurait annoncé une fermeture que le
      // serveur n'aurait pas prononcée.
      failure_after_turns: this.script.limits.lock.turns_per_scene,
      lock_hours: this.script.limits.lock.hours,
      hard_turn_cap: this.scene.turn.hard_turn_cap,
      autonomous_notice: this.scene.turn.autonomous_notice,
      budget_usd: this.script.pricing.scene_budget_usd,
      price_input_per_1m_usd: this.script.pricing.input_per_1m_usd,
      price_output_per_1m_usd: this.script.pricing.output_per_1m_usd,
    }
  }

  /** Message utilisateur envoyé à gpt-4o pour produire la scène. */
  /**
   * Le schéma demandé au modèle, ajusté à la scène.
   *
   * Une scène sans objet scellé ne doit pas s'en voir réclamer un : sans son
   * bloc d'instructions, le modèle en inventerait un au hasard, et on paierait
   * la sortie d'un champ que personne ne lit.
   */
  private outputSchema(canTrade: boolean): Record<string, unknown> {
    const schema = { ...this.scene.generation.output_schema } as Record<string, unknown>
    if (!this.scene.sealed_object) delete schema.sealed_object
    // La quête de la nuit ne s'écrit qu'une fois, à l'auberge. Ailleurs elle
    // arrive par le journal : la réécrire coûterait un millier de jetons par
    // scène, et chaque réécriture pourrait la faire dériver.
    if (!this.isStart) delete schema.night

    // LA SÉQUENCE est la seule énigme dont le modèle écrit un morceau : les
    // gestes du dénouement, qui sont ceux de CE joueur. Réclamés ici et nulle
    // part ailleurs — ailleurs ce serait une sortie payée que personne ne lit.
    if (this.scene.key_item.puzzle === 'sequence' && schema.key_item) {
      schema.key_item = {
        ...(schema.key_item as Record<string, unknown>),
        steps: ["string (4 gestes COURTS, 2 à 5 mots chacun, à l'impératif, DANS L'ORDRE où ils s'accomplissent — ils décomposent resolving_action)"],
      }
    }

    // UN ÉLÉMENT CACHÉ NE SE DÉCOUVRE QUE PAR UN ÉCHANGE, et un échange n'existe
    // que si le joueur porte quelque chose de troquable. Le schéma proposait
    // `hidden` dans tous les cas : le modèle posait alors une trappe que
    // personne ne pouvait montrer, et la scène partait en 502. C'est l'état
    // normal en sortant de l'auberge — le joueur n'a que son augmentation, qui
    // n'est même pas dans l'inventaire : une greffe ne se troque pas.
    if (!canTrade) {
      const objects = schema.interactables as Array<Record<string, unknown>> | undefined
      if (objects?.length) {
        const { hidden: _drop, ...fields } = objects[0]!
        schema.interactables = [fields]
      }
    }

    // La couleur d'une carte de plus ne se demande que là où il y en a une.
    if (!this.scene.interactables.spare_card) {
      const objects = schema.interactables as Array<Record<string, unknown>> | undefined
      if (objects?.length) {
        const { card_color: _c, card_hex: _h, ...fields } = objects[0]!
        schema.interactables = [fields]
      }
    }
    return schema
  }

  /**
   * Le prompt de l'épilogue.
   *
   * Il ne demande ni personnages, ni quête, ni objet-clé : la partie est finie.
   * Il demande un texte, la palette d'une aube, et de quoi peupler l'image
   * de ce que CE joueur a traversé. Le journal y passe en ENTIER — c'est le
   * seul moment où toute la nuit compte, on ne le tronque donc pas.
   */
  buildEndingPrompt(
    user: UserProfile,
    journal: JournalEntry[] = [],
    carried: CarriedItem[] = [],
  ): string {
    const s = this.scene
    const theme = resolveTheme(user, this.script)
    const slots = s.decor_slots
      .map(slot => `  - ${slot.id} (poids visuel : ${slot.visual_weight}) : ${slot.role}`)
      .join('\n')

    return `${this.languageBlock}

PROFIL DU JOUEUR
${describeUser(user, this.hasReading(journal))}
${this.describeReading(journal)}
${this.describeResolution(theme, nightOf(journal))}
${this.describeTouchstones(user, true)}

TOUTE SA NUIT, DANS L'ORDRE
${journal.length ? renderJournal(journal, journal.length) : "Il n'a traversé aucune scène : reste sur ce que dit son profil."}

${this.describeCarried(carried, true)}

${this.script.defaults.deep_theme.instruction}
${this.describeCounsel()}

DIRECTION ARTISTIQUE
${s.art_direction.render}
${s.art_direction.accent_note}
${s.palette_derivation.instruction}

ÉLÉMENTS DE L'IMAGE À REMPLIR
${slots}
Pour chaque élément, "visual" doit être un fragment ANGLAIS court (max 12 mots) décrivant la forme visible, sans mentionner de couleur et sans aucun texte lisible.

L'ADIEU — le champ "farewell"
C'est le dernier mot du jeu, et le seul texte qui restera quand tout sera fermé. Ce monde a été bâti pour CE joueur et il ne se rejoue pas : dis-le en reprenant une image de SA nuit, jamais une formule générale. Deux à trois phrases, 400 caractères au maximum — au-delà il sera tronqué.

SORTIE ATTENDUE
Un unique objet JSON respectant ce schéma, sans markdown :
${JSON.stringify(s.generation.output_schema, null, 2)}`
  }

  /**
   * L'instruction de l'épilogue, avec sa lecture finale.
   *
   * Le quatrième mouvement est le SEUL endroit du jeu où l'on s'adresse au
   * joueur en clair plutôt que par la fiction. Il a donc ses propres registres,
   * tenus par le script : sans eux le modèle glisse vers l'horoscope ou vers le
   * développement personnel, deux registres que tout le reste refuse.
   */
  /**
   * Ce que la nuit fait des repères du dossier : le moment, le film, l'animal,
   * le morceau, et ce qu'il ne supporte pas.
   *
   * Rien si le joueur n'en a donné aucun — la consigne décrirait des réponses
   * absentes. Le rôle de chacun est écrit une fois dans le script ; l'épilogue a
   * sa propre version, parce que c'est le seul moment où ils se retrouvent tous.
   */
  private describeTouchstones(user: UserProfile, ending = false): string {
    const marks = user.touchstones
    const any = marks?.moment || marks?.fear_film || marks?.animal
      || user.anthem || user.imprints?.aversion
    if (!any) return ''
    const t = this.script.defaults.touchstones
    return `\nSES REPÈRES\n${ending ? t.ending : t.instruction}\n`
  }

  private describeCounsel(): string {
    const s = this.scene
    const counsel = s.counsel
    if (!counsel) return s.generation.instruction

    const registers = counsel.registers.map(r => `  - ${r}`).join('\n')
    return interpolate(s.generation.instruction, {
      counsel: interpolate(counsel.instruction, { registers }),
    })
  }

  /**
   * Le thème, cadré pour une fin.
   *
   * Les blocs SIGNE et NOMBRES ordinaires disent comment BÂTIR une scène — la
   * quête à écrire, les personnages à distribuer. Ici il n'y a plus rien à
   * bâtir : ce qui reste, c'est le point d'arrivée. On rappelle donc d'où le
   * joueur est parti, où toute la partie le menait, et quelle facette chaque
   * acte mettait à l'épreuve.
   */
  private describeResolution(theme: PlayerTheme | null, plan?: NightPlan): string {
    const frame = this.scene.theme_frame
    if (!frame || !theme?.sign) return theme ? this.describeTheme(theme) : ''

    const labels: Record<string, string> = {
      terrain: "ce que la nuit lui oppose",
      destiny: "la forme de son objectif",
      reception: "la façon dont le monde le reçoit",
      heritage: "ce que son nom traîne",
    }
    const numbers = theme.numbers as Record<string, string | null>

    const acts = this.script.acts
      .filter(a => a.id !== this.scene.act)
      .map((a) => {
        // La facette d'un acte est celle de ses scènes : on la lit sur la
        // première d'entre elles plutôt que de la redéclarer ailleurs.
        const first = this.script.scenes.find(sc => sc.id === a.scenes[0])
        const facet = first?.theme_focus?.facet
        const value = facet ? numbers[facet] : null
        // Les titres d'acte sont ceux que le plan a donnés à SA nuit.
        const title = plan?.acts?.find(p => p.act_id === a.id)?.title ?? a.title
        return `  - ${title} — ${facet ? labels[facet] : 'son parcours'}`
          + (value ? ` : ${value}` : '')
      })
      .join('\n')

    return interpolate(frame.instruction, {
      tension: theme.sign.tension,
      resolution: theme.sign.resolution,
      acts,
    })
  }

  /**
   * Valide et assemble l'épilogue.
   *
   * Le HTML vient du modèle et sera affiché tel quel : il est réduit ici, côté
   * serveur, aux quatre balises autorisées. Le filtrer côté client laisserait
   * passer la fenêtre où il n'a pas encore été filtré.
   */
  assembleEnding(generated: GeneratedEnding, placeName: string) {
    if (!generated.ending_html) throw new Error('Fin invalide : ending_html manquant')
    for (const key of ['dominant', 'secondary', 'accent'] as const) {
      const color = generated.palette?.[key]
      if (!color?.hex || !HEX_RE.test(color.hex)) {
        throw new Error(`Fin invalide : palette.${key}.hex absent ou mal formé`)
      }
    }

    const audit = enforceAccentVisibility(generated.palette)
    const palette = audit.palette
    const html = sanitizeHtml(generated.ending_html)
    if (!html) throw new Error('Fin invalide : le HTML ne contient aucune balise autorisée')

    return {
      kind: 'ending' as const,
      scene_id: this.scene.id,
      scene_title: generated.title || this.title,
      ending_html: html,
      palette,
      decor: generated.decor ?? [],
      interface_palette: 'from_scene' as const,
      image_prompt: this.buildImagePrompt({
        place_name: placeName || this.title,
        palette,
        decor: generated.decor ?? [],
      }),
      static_image: null,
      script_version: this.script.version,
    }
  }

  buildGenerationPrompt(
    user: UserProfile,
    journal: JournalEntry[] = [],
    carried: CarriedItem[] = [],
  ): string {
    const s = this.scene
    // L'épilogue n'a ni quête ni personnages : le passer ici échouait sur un
    // « Cannot read properties of undefined » qui ne disait pas où chercher.
    if (this.kind === 'ending') {
      throw new Error(
        `La scène "${s.id}" est un épilogue : utilise buildEndingPrompt, pas buildGenerationPrompt`)
    }

    const slots = s.decor_slots
      .map(slot => `  - ${slot.id} (poids visuel : ${slot.visual_weight}) : ${slot.role} — source : ${slot.source}`)
      .join('\n')

    const questFields = Object.entries(s.quest.structure)
      .map(([k, v]) => `  - ${k} : ${v}`)
      .join('\n')

    const theme = resolveTheme(user, this.script)
    const themeBlock = theme ? this.describeTheme(theme) : ''
    const tension = theme?.sign?.tension ?? ''

    // Rien de troquable, rien à réclamer : la section entière ne ferait que
    // décrire au modèle une mécanique qu'il n'a pas de quoi armer.
    const canTrade = carried.some(o => o.kind === 'trade')

    const c = this.script.defaults.continuity
    const story = journal.length
      ? interpolate(c.prompt, { journal: renderJournal(journal, c.max_entries) })
      : c.empty
    const exactPalette = deterministicPaletteHexes(user, this.scene.id)

    return `${this.languageBlock}

PROFIL DU JOUEUR
${describeUser(user, this.hasReading(journal))}
${themeBlock}
${this.describeTouchstones(user)}
${story}

LA QUÊTE DE LA NUIT
${this.describeNight(theme, journal)}
${this.describeReading(journal)}

${this.describeCarried(carried)}
${canTrade ? `\nCE QU'UN PERSONNAGE PEUT EN VOULOIR\n${this.script.defaults.exchange.instruction}\n` : ''}

NOM DU LIEU
${interpolate(s.naming.instruction, this.langVars)}
${this.pack.generation.naming_form}

PALETTE
${s.palette_derivation.instruction}
Le calcul depuis le formulaire est déjà fait pour CE lieu. Ces trois hexadécimaux sont la réponse définitive : recopie-les à l'identique dans le champ palette, sans les éclaircir, les assombrir ni les remplacer. Donne seulement à chacun un nom cohérent dans la langue du joueur et explique sa dérivation dans le champ rationale.
- dominante : ${exactPalette.dominant}
- secondaire : ${exactPalette.secondary}
- accent : ${exactPalette.accent}
Contrainte de rendu : ${s.art_direction.render}, règle 60/30/10 stricte.
${s.art_direction.accent_note}

ÉLÉMENTS DE DÉCOR À REMPLIR
${slots}
Pour chaque élément, "visual" doit être un fragment ANGLAIS court (max 12 mots) décrivant la forme visible, sans mentionner de couleur.

SYLLABAIRE
${this.describeSyllabary(tension)}

${this.describeObjective(theme)}
PERSONNAGES
${s.npcs.instruction} Exactement ${s.npcs.count} personnages.
${this.describeCast()}
${this.describeKnowledge()}

${this.script.defaults.deep_theme.instruction}

QUÊTE
${s.quest.instruction}
${questFields}


OBJET-CLÉ
${s.key_item.instruction}${s.key_item.puzzle ? `\n${this.script.defaults.puzzles.scene_rule}` : ''}

${this.script.defaults.locks.instruction}

${s.sealed_object
  ? `OBJET SCELLÉ\n${interpolate(s.sealed_object.instruction, { quest_title: 'la quête' })}\n`
  : ''}
OBJETS MANIPULABLES
${s.interactables.instruction}${s.interactables.spare_card ? `\n${this.script.defaults.spare_card.instruction}` : ''}
Le verbe de l'objet à prendre s'écrit exactement ainsi : ${this.takeVerbs}.

${this.script.defaults.item_icons.instruction}

TEXTE DE SCÈNE
${s.narrative.instruction}
${this.vocabulary}
${this.namingStyle}
La sortie de ce lieu se nomme exactement : ${this.exitLabel}.
${s.narrative.opening}
${s.narrative.stakes_rule ?? ''}
Structure imposée :
${s.narrative.structure.map((x, i) => `  ${i + 1}. ${x}`).join('\n')}
Maximum ${s.narrative.max_words} mots. Interdit : ${s.narrative.forbidden.join(', ')}.
Le champ "interactables" doit lister exactement les objets nommés dans le texte, et inclure impérativement la sortie.

${this.script.defaults.game_over.instruction}

SORTIE ATTENDUE
Un unique objet JSON respectant ce schéma, sans markdown :
${JSON.stringify(this.outputSchema(canTrade), null, 2)}`
  }

  /** La table de composition des noms. Jointe à la génération, jamais aux tours. */
  private describeSyllabary(tension: string): string {
    const o = this.script.onomastics
    const list = (table: Record<string, string>) =>
      Object.entries(table).map(([syl, sens]) => `  ${syl} = ${sens}`).join('\n')

    // La tension est rappelée ici, à l'endroit exact où le modèle compose :
    // renvoyer à une section plus haut suffit rarement.
    const anchor = tension ? `\nTension à encoder dans les noms : ${tension}\n` : ''

    return `${o.instruction}
${anchor}

MATIÈRE — première syllabe
${list(o.matiere)}

POSTURE — syllabe finale
${list(o.posture)}`
  }

  /** Les sections SIGNE et NOMBRES du prompt de génération. */
  /**
   * L'objectif de la scène, tel que ce joueur-là le rencontre.
   *
   * L'exigence mécanique — obtenir la carte, lire la fréquence — ne bouge
   * jamais : c'est la structure de l'arc. Ce qui change, c'est ce qu'elle
   * DEMANDE à ce joueur, et ça se déduit de la facette qui gouverne l'acte.
   */
  /**
   * Ce que le joueur transporte en arrivant.
   *
   * Sans ce bloc, chaque scène était un vase clos : le modèle ne pouvait pas
   * bâtir un puzzle sur un objet ramassé deux scènes plus tôt, puisqu'il en
   * ignorait l'existence. Un objet dont le nom n'a pas encore été déchiffré
   * est décrit par sa forme, jamais nommé — le joueur ne le connaît pas.
   */
  private describeCarried(carried: CarriedItem[], ending = false): string {
    const inv = this.script.defaults.inventory
    if (!carried.length) return ending ? inv.ending_empty : inv.empty

    // La nature de l'objet est dite au modèle : une carte se présente, un
    // souvenir se comprend. Sans elle, il traitait les deux pareil.
    const label = (o: CarriedItem) => o.decrypted ? o.label : `un objet ${inv.unread}`
    const mark = (o: CarriedItem) =>
      o.kind === 'key' ? 'OUVRE' : o.kind === 'trade' ? 'ÉCHANGE' : 'ÉCLAIRE'
    const items = carried
      .map(o => `  - [${mark(o)}] ${label(o)}`
        + (o.color ? ` — couleur : ${o.color}` : '')
        + (o.from ? ` — récupéré : ${o.from}` : ''))
      .join('\n')

    return interpolate(ending ? inv.ending_prompt : inv.prompt, { items })
  }

  /**
   * La quête de la nuit : le but, et la ville que ce joueur va traverser.
   *
   * Le script ne fixe que la mécanique — trois actes de deux lieux, ce qu'on
   * obtient dans chacun. À l'auberge, le modèle écrit d'abord le but, puis
   * invente les six lieux depuis le profil ; ensuite le plan voyage par le
   * journal et chaque scène se bâtit sur le sien. Une scène qui en inventerait
   * un autre défait tout ce qui précède.
   */
  private describeNight(theme: PlayerTheme | null, journal: JournalEntry[]): string {
    const n = this.script.defaults.night

    if (this.isStart) {
      return `${n.instruction}\n\n${this.describeCalculus(theme)}\n\n${n.reading}\n\n${interpolate(n.plan, { slots: this.describeSlots(theme) })}\n\n${n.derives}`
    }

    // Sans plan — un saut direct à une scène, un vieux journal — il ne reste
    // que la règle : le décor retombe sur le repli du script.
    const plan = nightOf(journal)
    const here = this.plan
    if (!plan || !here) return n.derives

    const rendered = plan.acts
      .map(act => [
        `  ${act.title}`,
        ...act.scenes.map(sc =>
          `    ${sc.scene_id === this.scene.id ? '→' : '-'} ${sc.title} — ${sc.place} · ${sc.step}`),
      ].join('\n'))
      .join('\n')

    return `${interpolate(n.fixed, {
      goal: plan.goal,
      title: plan.title ?? '',
      horizon: plan.horizon ?? '',
      plan: rendered,
      place: here.place,
      focal: here.focal,
      step: here.step,
      requirement: here.requirement,
      exit_label: here.exit_label,
    })}\n\n${n.derives}`
  }

  /** L'auberge a-t-elle lu le dossier ? Alors les réponses brutes ne voyagent plus. */
  private hasReading(journal: JournalEntry[]): boolean {
    const plan = nightOf(journal)
    return !this.isStart && Boolean(plan?.portrait?.trim() && plan?.totem?.trim())
  }

  /**
   * Ce que l'auberge a lu du dossier, rendu aux scènes suivantes.
   *
   * Vide tant qu'il n'y a pas de lecture — un vieux journal, un saut direct :
   * le profil garde alors la réponse brute, avec sa consigne de lecture.
   * Borné : le plan revient du navigateur, comme le reste du journal.
   */
  private describeReading(journal: JournalEntry[]): string {
    if (!this.hasReading(journal)) return ''
    const plan = nightOf(journal)!
    return interpolate(this.script.defaults.night.reading_fixed, {
      portrait: plan.portrait!.slice(0, 900),
      totem: plan.totem!.slice(0, 600),
    })
  }

  /**
   * L'aventure de la nuit, calculée depuis le signe et les nombres.
   *
   * Le modèle choisissait le but dans tout le dossier, et il prenait le plus
   * émouvant : la personne qui compte. La nuit devenait celle d'un autre
   * (« offrir à Vadim une place sous les projecteurs »). Les ingrédients sont
   * donc posés ligne à ligne, et les empreintes n'en font pas partie.
   */
  private describeCalculus(theme: PlayerTheme | null): string {
    const c = this.script.defaults.night.calculus
    const lines = [
      theme?.sign ? `  - Ce que sa vie lui refuse : ${theme.sign.tension}` : '',
      theme?.sign?.adventure ? `  - L'aventure que son signe réclame : ${theme.sign.adventure}` : '',
      theme?.numbers.destiny ? `  - La forme qu'elle prend : ${theme.numbers.destiny}` : '',
      theme?.numbers.terrain ? `  - Ce qui lui barre la route : ${theme.numbers.terrain}` : '',
      theme?.numbers.heritage ? `  - Ce que son nom traîne, à démentir en route : ${theme.numbers.heritage}` : '',
    ].filter(Boolean)
    return lines.length ? interpolate(c.instruction, { lines: lines.join('\n') }) : c.fallback
  }

  /**
   * La mécanique imposée, acte par acte, telle que le plan doit la remplir.
   *
   * Chaque acte dit la facette qu'il met à l'épreuve, avec la valeur que le
   * profil lui donne : c'est de là que le modèle tire des lieux qui
   * n'appartiennent qu'à ce joueur.
   */
  private describeSlots(theme: PlayerTheme | null): string {
    const numbers = theme?.numbers as Record<string, string | null> | undefined
    return this.script.acts
      .map((act) => {
        const slots = act.scenes
          .map(id => this.script.scenes.find(sc => sc.id === id))
          .filter((sc): sc is SceneScript => Boolean(sc) && sc!.kind !== 'ending')
        if (!slots.length) return ''
        const focus = slots[0]!.theme_focus
        const value = focus ? numbers?.[focus.facet] : null
        const head = `ACTE ${act.id} — ${act.arc}`
          + (focus ? `\n  Ce qu'il met à l'épreuve : ${focus.facet_label}${value ? ` — ${value}` : ''}` : '')
        const lines = slots.map(sc =>
          `  - ${sc.id} : ${sc.mechanic ?? ''} — exigence type : ${sc.objective?.requirement ?? ''}`)
        return [head, ...lines].join('\n')
      })
      .filter(Boolean)
      .join('\n\n')
  }

  private describeObjective(theme: PlayerTheme | null): string {
    const focus = this.scene.theme_focus
    const objective = this.scene.objective
    if (!focus || !objective?.requirement) return ''

    // La valeur de la facette vient du profil ; sans elle, on garde le libellé
    // plutôt que d'écrire « undefined » dans le prompt.
    const value = (theme?.numbers as Record<string, string | null> | undefined)?.[focus.facet]

    return '\n' + interpolate(this.script.defaults.objective_derivation.instruction, {
      requirement: objective.requirement,
      axis: focus.axis,
      step: String(focus.step),
      act: this.scene.act ?? '',
      facet: focus.facet_label,
      facet_value: value ?? 'non renseignée — appuie-toi alors sur la seule tension du SIGNE',
    }) + '\n'
  }

  /**
   * Les positions imposées aux personnages de la scène.
   *
   * Elles viennent du syllabaire : une syllabe de posture n'est pas une
   * étiquette, c'est ce que le personnage a fait de la même tension que le
   * joueur. Elle décide donc à la fois de son nom, de sa voix et de ce qu'il
   * veut — les trois tiennent ensemble ou aucun ne tient.
   */
  private describeCast(): string {
    const stances = this.scene.cast_stances
    if (!stances?.length) return ''

    const { holder_stance: holder, informant_stance: informant } = this.scene.key_item
    const lines = stances.map((st, i) => {
      const marks = [
        i === 0 ? 'c\'est lui qui accueille le joueur' : '',
        holder && st.posture === holder ? 'c\'est LUI qui DÉTIENT l\'objet-clé' : '',
        informant && st.posture === informant ? 'c\'est lui qui SAIT où il est, sans l\'avoir' : '',
      ].filter(Boolean)
      return `  ${i + 1}. ${st.posture} : ${st.means}${marks.length ? ' — ' + marks.join(' ; ') : ''}`
    }).join('\n')

    return `${this.script.defaults.cast.instruction}\nPositions imposées, dans cet ordre :\n${lines}`
  }

  /**
   * Ce que la salle apprend au joueur, réparti entre ses habitants.
   *
   * L'auberge est le seul lieu du jeu où l'on s'assoit et où l'on parle : après
   * elle, on avance. Ce que le joueur y aura compris est tout ce qu'il emporte,
   * et c'est pour ça que ce qui l'attend dehors se dit ICI — par les gens, un
   * morceau chacun. Aucun ne connaît le trajet entier : celui qui saurait tout
   * rendrait les trois autres décoratifs, et il n'y aurait plus de raison de
   * leur parler.
   */
  private describeKnowledge(): string {
    const k = this.scene.npcs.knowledge
    if (!k?.fragments?.length) return ''

    const lines = k.fragments
      .map((f, i) => `  ${i + 1}. ${f.npc}\n     CE QU'IL SAIT : ${f.holds}\n     COMMENT ÇA SORT : ${f.told_as}`)
      .join('\n')

    return `\nCE QUE LA SALLE APPREND\n${k.instruction}\n`
      + `Répartition, un morceau par personnage, dans l'ordre de la liste :\n${lines}\n`
  }

  private describeTheme(theme: PlayerTheme): string {
    const parts: string[] = []

    if (theme.sign) {
      parts.push(`
SIGNE
${this.script.zodiac.generation_instruction}
Tension : ${theme.sign.tension}
Résolution recherchée : ${theme.sign.resolution}`)
    }

    const n = theme.numbers
    if (n.terrain || n.destiny || n.reception || n.heritage) {
      const lines = [
        n.terrain ? `  - Ce que la nuit lui oppose : ${n.terrain}` : '',
        n.destiny ? `  - Forme de l'objectif : ${n.destiny}` : '',
        n.reception ? `  - Accueil du monde : ${n.reception}` : '',
        n.heritage ? `  - Ce que son nom traîne : ${n.heritage}` : '',
      ].filter(Boolean).join('\n')

      parts.push(`
NOMBRES
${this.script.numerology.generation_instruction}
${lines}`)
    }

    return parts.join('\n')
  }

  /**
   * Assemble le prompt image depuis le gabarit statique.
   * Toujours reconstruit côté serveur : le client ne fournit jamais de prompt libre.
   */
  buildImagePrompt(input: { place_name: string; palette: ScenePalette; decor: DecorElement[] }): string {
    const ad = this.scene.art_direction

    const decorLine = input.decor
      .filter(d => d.visual && d.slot_id !== 'ambiance_sonore')
      .map(d => d.visual)
      .join('; ')

    return interpolate(ad.image_prompt_template, {
      setting: this.scene.image_setting,
      scene_name: input.place_name,
      focal_element: this.scene.focal_element,
      dominant_hex: input.palette.dominant.hex,
      dominant_name: input.palette.dominant.name,
      secondary_hex: input.palette.secondary.hex,
      secondary_name: input.palette.secondary.name,
      accent_hex: input.palette.accent.hex,
      accent_name: input.palette.accent.name,
      decor_line: decorLine,
      constraints: ad.constraints.join(', '),
    })
  }

  /** Portrait de PNJ, dans la palette de la scène pour rester cohérent. */
  buildPortraitPrompt(input: { appearance: string; palette: ScenePalette }): string {
    const ad = this.scene.art_direction
    return interpolate(ad.portrait_prompt_template, {
      appearance: input.appearance,
      dominant_hex: input.palette.dominant.hex,
      dominant_name: input.palette.dominant.name,
      secondary_hex: input.palette.secondary.hex,
      secondary_name: input.palette.secondary.name,
      accent_hex: input.palette.accent.hex,
      accent_name: input.palette.accent.name,
      constraints: ad.constraints.join(', '),
    })
  }

  /**
   * Ce que le modèle a posé sans que personne puisse le montrer.
   *
   * Un élément `hidden` que nul `reveals_id` ne désigne est invisible pour
   * toujours — mais il est aussi, par construction, absent partout : le schéma
   * lui interdit `scene_text`, `visible()` l'écarte du récit comme du bouton
   * « Ramasser », et l'oracle ne le compte pas. Le refuser coûtait au joueur
   * la scène entière — deux générations, puis un 502 en travers du
   * rechargement — pour une trappe que personne n'aurait jamais vue. On
   * l'enlève : ce qui reste est exactement la scène qui allait s'afficher.
   */
  dropUnreachable(generated: GeneratedScene): void {
    // Le cas symétrique : un `reveals_id` qui ne désigne aucun élément caché.
    // Le modèle y met l'id de l'objet-clé — « a1s1_card » — pour faire remettre
    // la carte par l'échange, ce que la règle interdit déjà à `reward_item`.
    // L'échange retombe sur sa première forme, ce qu'il sait : `reward` reste
    // sa réplique, et la carte se mérite par le chemin prévu.
    const hiddenIds = new Set((generated.interactables ?? []).filter(o => o.hidden).map(o => o.id))
    for (const npc of generated.npcs ?? []) {
      const id = npc.wants?.reveals_id
      if (id && !hiddenIds.has(id)) {
        console.warn(`[scene/${this.scene.id}] ${npc.name} découvrait "${id}", qui n'est pas caché : retiré`)
        delete npc.wants!.reveals_id
      }
    }

    const revealed = (generated.npcs ?? [])
      .map(n => n.wants?.reveals_id).filter((id): id is string => Boolean(id))
    const objects = generated.interactables ?? []
    const orphans = objects.filter(o => o.hidden && !revealed.includes(o.id))
    if (!orphans.length) return

    console.warn(`[scene/${this.scene.id}] caché sans personne pour le montrer, retiré : `
      + orphans.map(o => o.label || o.id).join(' · '))
    generated.interactables = objects.filter(o => !orphans.includes(o))
  }

  /**
   * Le nom de l'augmentation, ressoudé avant d'être jugé.
   *
   * La consigne exige un nom sans accent, et le modèle écrit en français :
   * « LentilleNéonIntervalle » arrivait, et la scène entière partait en
   * réparation pour une seule lettre. Retirer l'accent ou recoller deux
   * morceaux ne change rien à ce qu'il a voulu dire. On corrige donc le nom,
   * et chaque texte généré qui le cite, pour que le récit et la fiche restent
   * identiques à la lettre. Ce qui ne se ressoude pas reste refusé plus bas.
   */
  weldAugmentationName(generated: GeneratedScene): void {
    const item = generated.key_item
    if (this.scene.objective?.kind !== 'acquire_augmentation' || !item?.name || !generated.scene_text) return
    // Sans casse, rien à ressouder : le nom est un composé natif.
    if (this.pack.writing?.signal === 'bold') return

    const from = item.name
    const segments = from
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^A-Za-z]+/).filter(Boolean)
      .flatMap(w => w.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [])
      .map(w => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    const weld = (parts: string[]) => parts.join('')

    // Les segments écrits dans le récit, séparés ou non, accents compris :
    // « Vise Lueur », « Vise-Lueur », « VISE LUEUR », « ViseLueur ».
    const ACCENTS: Record<string, string> = {
      a: 'aàáâäã', c: 'cç', e: 'eéèêë', i: 'iíìîï', n: 'nñ', o: 'oóòôöõ', u: 'uúùûü', y: 'yÿ',
    }
    const loose = (parts: string[]) => new RegExp(
      `(?<!\\p{L})${parts
        .map(w => [...w.toLowerCase()].map(ch => ACCENTS[ch] ? `[${ACCENTS[ch]}]` : ch).join(''))
        .join("[\\s\\-'’]*")}(?!\\p{L})`,
      'giu')

    // Le nom retenu : le nom entier s'il est dans le récit, sinon la plus longue
    // suite de segments que le récit prononce — c'est elle que le joueur lira,
    // et la fiche doit dire la même chose que le barman.
    const candidates: string[][] = [segments]
    for (let size = segments.length - 1; size >= 2; size--) {
      for (let i = segments.length - size; i >= 0; i--) candidates.push(segments.slice(i, i + size))
    }
    const found = candidates.find(parts =>
      AUGMENTATION_NAME_RE.test(weld(parts)) && loose(parts).test(generated.scene_text))
    if (!found) return

    const welded = weld(found)
    const pattern = loose(found)
    const replace = (value: unknown): unknown => {
      if (typeof value === 'string') return value.split(from).join(welded).replace(pattern, welded)
      if (Array.isArray(value)) return value.map(replace)
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) (value as Record<string, unknown>)[k] = replace(v)
      }
      return value
    }
    const before = generated.scene_text
    replace(generated)
    item.name = welded
    if (welded !== from || before !== generated.scene_text) {
      console.warn(`[scene/${this.scene.id}] nom de l'augmentation ressoudé : ${from} → ${welded}`)
    }
  }

  /** Garde-fou : le modèle oublie régulièrement un champ. */
  assertValid(generated: GeneratedScene): void {
    if (!generated.place?.name) throw new Error('Scène invalide : place.name manquant')
    if (!generated.scene_text) throw new Error('Scène invalide : scene_text manquant')

    for (const key of ['dominant', 'secondary', 'accent'] as const) {
      const color = generated.palette?.[key]
      if (!color?.hex) throw new Error(`Scène invalide : palette.${key}.hex manquant`)
      if (!HEX_RE.test(color.hex)) {
        throw new Error(`Scène invalide : palette.${key}.hex "${color.hex}" n'est pas un hex #RRGGBB`)
      }
    }

    const present = new Set(generated.decor?.map(d => d.slot_id) ?? [])
    for (const slot of this.scene.decor_slots) {
      if (slot.required && !present.has(slot.id)) {
        throw new Error(`Scène invalide : slot de décor requis "${slot.id}" absent`)
      }
    }

    if (!generated.quest?.title) throw new Error('Scène invalide : quest.title manquant')

    // LA QUÊTE DE LA NUIT. C'est la racine de toute la partie : sans elle, le
    // modèle construit l'ouverture sur l'objet à récupérer — « Vadim t'a
    // laissé quelque chose ici » — et les six lieux suivants n'ont plus rien
    // qui les tienne ensemble. Seule l'auberge l'écrit, et elle doit être
    // entière : un lieu manquant serait une scène sans décor.
    //
    // `exit_label` fait exception : `exitLabel` (plus bas) sait déjà le
    // reprendre depuis `exit_labels.<id>` du pack de langue — une valeur
    // curée, garantie présente pour CHAQUE scène par `check-lang.mjs` — dès
    // que le plan ne l'a pas écrit. C'est le dernier champ du dernier lieu du
    // JSON le plus lourd de tout le jeu : le modèle l'oublie de temps en
    // temps sans que rien d'autre manque, et le faire échouer sur CE seul
    // champ payait une reprise entière pour une valeur qu'on sait déjà
    // reconstruire à l'identique.
    if (this.isStart) {
      const night = generated.night
      const missing: string[] = []
      for (const f of ['goal', 'tension', 'release'] as const) {
        if (!night?.[f]?.trim()) missing.push(`night.${f}`)
      }
      const planned = new Map((night?.acts ?? []).flatMap(a => a.scenes ?? []).map(sc => [sc.scene_id, sc]))
      const fields = ['title', 'place', 'focal', 'step', 'requirement'] as const
      for (const id of this.planIds) {
        const sc = planned.get(id)
        if (!sc) { missing.push(`${id} (lieu absent)`); continue }
        const empty = fields.filter(f => !sc[f]?.trim())
        if (empty.length) missing.push(`${id} (${empty.join(', ')})`)
      }
      if (missing.length) {
        throw new Error(`Scène invalide : la quête de la nuit est incomplète — ${missing.join(' ; ')}`)
      }
    }

    // L'HORIZON N'EST PAS UNE CARTE D'ACCÈS. Les cartes colorées sont la
    // mécanique de toutes les scènes suivantes, et le modèle y retombe : il
    // promet alors, dans la phrase du sas, le laissez-passer de la scène
    // d'après. C'est la dernière chose que le joueur lit avant de payer — elle
    // doit nommer le bout de la nuit, pas la prochaine serrure. Seule la
    // famille « carte » est filtrée, c'est la seule sur laquelle il glisse, et
    // dans les douze langues puisque le texte est généré dans la sienne. La
    // liste est volontairement étroite : un refus à tort coûte une réparation.
    const CARD = /(?<!\p{L})(cartes?|cards?|tarjetas?|karten?|kaart(?:en)?|cartas?|cart(?:ão|ao|ões|oes)|kart[ıiyaąę]?|kartlar[ıi]?|kartu|карт[аыуой]|thẻ)(?!\p{L})/iu
    if (generated.quest.artifact && CARD.test(generated.quest.artifact)) {
      throw new Error(
        `Scène invalide : quest.artifact est une carte ("${generated.quest.artifact}") — `
        + "l'horizon de la nuit ne peut pas être un laissez-passer, "
        + 'écris ce qui se tient au bout de la montée')
    }

    // Le modèle recopie parfois la mécanique dans l'archétype affiché, ce qui
    // révèle au joueur qui détient quoi avant même qu'il ait parlé à personne.
    const LEAKS = /informat|d[ée]tent|porteur de|gardien de l|personnage.cl|t[ée]moin.cl|\bindice\b|\bcontact\b|\bpnj\b/i
    for (const npc of generated.npcs ?? []) {
      if (npc.archetype && LEAKS.test(npc.archetype)) {
        throw new Error(`Scène invalide : l'archétype de ${npc.name} révèle sa fonction ("${npc.archetype}")`)
      }
    }

    if (!Array.isArray(generated.npcs) || generated.npcs.length === 0) {
      throw new Error('Scène invalide : aucun PNJ')
    }

    // UNE SALLE DOIT AVOIR QUELQUE CHOSE À RAMASSER. C'est la seule voie du jeu
    // qui ne passe pas par une conversation : l'objet est posé là, la Majuscule
    // est le seul signal, et c'est au joueur de le voir. Le modèle, laissé
    // libre, fait tout passer par les gens — et à l'auberge l'objet manquant
    // ferme le sas, qui attend qu'on ait déchiffré quelque chose.
    const takeable = (generated.interactables ?? []).filter(o => isTakeable(o, this.lang))
    if (!takeable.length) {
      throw new Error(
        'Scène invalide : aucun objet à ramasser — un objet au moins doit être posé dans le '
        + `décor avec pour verbe ${this.takeVerbs}, en plus de ce que les personnages donnent`)
    }
    // CE QU'UN ÉCHANGE DÉCOUVRE DOIT EXISTER. Un `reveals_id` qui ne désigne
    // rien fait promettre au personnage, dans sa réplique même, une chose qui
    // n'apparaîtra jamais : l'échange ne fait plus avancer, et c'est toute sa
    // raison d'être. Le cas symétrique — un `hidden` que personne ne montre —
    // n'est plus une erreur : `dropUnreachable` l'a retiré avant d'arriver ici.
    const hidden = (generated.interactables ?? []).filter(o => o.hidden)
    for (const npc of generated.npcs ?? []) {
      const id = npc.wants?.reveals_id
      if (id && !hidden.some(o => o.id === id)) {
        throw new Error(
          `Scène invalide : un personnage découvre "${id}", qui n'est pas un interactable caché`)
      }
    }

    // Un échange rend UNE chose : ce qu'il sait, un objet, ou ce qu'il montre.
    for (const npc of generated.npcs ?? []) {
      if (npc.wants?.reward_item?.id && npc.wants.reveals_id) {
        throw new Error(
          `Scène invalide : ${npc.name} rend un objet ET découvre un élément — l'un ou l'autre`)
      }
    }

    if (!takeable.some(o => o.observation?.trim())) {
      throw new Error(
        `Scène invalide : "${takeable[0].label}" se ramasse mais ne porte aucune observation — `
        + "la loupe n'aurait rien à y lire")
    }

    // Une scène qui répartit ce qu'elle apprend le fait sur TOUS ses habitants :
    // les morceaux se recollent, et il en manque un dès qu'un personnage rend
    // le sien vide. Le joueur parlerait alors à quelqu'un qui n'a rien à dire
    // de dehors, sans jamais savoir que c'est le script qui a lâché.
    if (this.scene.npcs.knowledge?.fragments?.length) {
      const mute = generated.npcs.filter(n => !n.beyond?.trim())
      if (mute.length) {
        throw new Error(
          `Scène invalide : ${mute.map(n => n.name || n.id).join(', ')} `
          + `${mute.length > 1 ? "n'ont" : "n'a"} pas de champ "beyond" — `
          + 'un morceau de ce qui attend dehors manque, et la salle ne le dira plus')
      }
    }

    // Un personnage que le TEXTE ne nomme pas est un personnage inatteignable.
    // Le panneau du haut n'affiche que des tirets tant qu'on ne lui a pas parlé,
    // et on ne peut lui parler qu'en tapant son nom : le récit est la seule
    // source. Une scène qui décrit « un homme en uniforme gris » sans le nommer
    // n'a rien à chiffrer, donc rien à chercher, et sa chaîne informateur puis
    // détenteur ne peut jamais s'ouvrir. Elle est injouable, pas imparfaite.
    const written = fold(generated.scene_text)
    const unnamed = generated.npcs.filter(n => n.name && !written.includes(fold(n.name)))
    if (unnamed.length) {
      throw new Error(
        `Scène invalide : ${unnamed.map(n => n.name).join(', ')} `
        + `${unnamed.length > 1 ? 'ne sont pas nommés' : "n'est pas nommé"} dans le texte `
        + '— le joueur ne pourrait s\'adresser à personne')
    }

    // Le bloc manquant en entier, c'est presque toujours un JSON que le modèle a
    // refermé trop tôt : on dit ce qu'il a rendu, sans quoi rien ne distingue
    // un bloc oublié d'un champ rangé sous un autre nom.
    const item = generated.key_item
    if (!item) {
      console.error(`[scene/${this.scene.id}] key_item absent, clés rendues :`, Object.keys(generated).join(', '))
      throw new Error('Scène invalide : le bloc `key_item` manque en entier — écris-le, complet')
    }
    const missing = (['name', 'npc_id'] as const).filter(k => !item[k]?.trim())
    if (missing.length) {
      console.error(`[scene/${this.scene.id}] key_item incomplet, champs rendus :`, Object.keys(item).join(', '))
      throw new Error(`Scène invalide : key_item.${missing.join(' et key_item.')} manquant`)
    }

    // L'AUGMENTATION SEULE porte un nom soudé, et le récit doit le prononcer
    // dès l'ouverture. Il est en CLAIR, contrairement à tout le reste de ce qui
    // s'acquiert : c'est l'outil avec lequel on déchiffre, le brouiller
    // reviendrait à le faire ouvrir par lui-même. Sa majuscule est tout le
    // signal — elle dit qu'il y a là quelque chose, et ce qu'on en fait est
    // d'aller la chercher parmi les gens. Soudé en un seul mot pour cette
    // raison exactement : un nom en plusieurs morceaux se lit comme une
    // description du décor, et plus rien ne le distingue.
    if (this.scene.objective?.kind === 'acquire_augmentation') {
      if (this.pack.writing?.signal === 'bold') {
        const re = this.pack.writing.dir === 'rtl' ? ARABIC_AUGMENTATION_NAME_RE : DENSE_AUGMENTATION_NAME_RE
        // Le modèle vocalise parfois l'arabe : les voyelles brèves ne changent pas le nom.
        if (!re.test(item.name.trim().replace(/[\u064B-\u065F\u0670]/g, ''))) {
          throw new Error(
            `Scène invalide : key_item.name "${item.name}" n'est pas un nom composé court `
            + '(un seul composé sans espace ni ponctuation, ou deux mots arabes au plus)')
        }
      } else if (!AUGMENTATION_NAME_RE.test(item.name)) {
        throw new Error(
          `Scène invalide : key_item.name "${item.name}" n'est pas un nom soudé `
          + '(deux ou trois segments à majuscule, sans espace, sans trait d\'union, sans accent) — « FocaleBraise »')
      }
      if (!written.includes(fold(item.name))) {
        throw new Error(
          `Scène invalide : "${item.name}" n'apparaît pas dans le texte d'ouverture — `
          + 'rien ne dirait au joueur ce qu\'il est venu chercher ici')
      }
      if (!item.observation?.trim()) {
        throw new Error(
          'Scène invalide : key_item.observation manquante — l\'augmentation '
          + 'n\'aurait rien à dire d\'elle-même dans l\'inventaire')
      }
    }

    // Comment l'objet-clé s'obtient dépend de la scène, pas du moteur. L'auberge
    // a trois rôles distincts — celui qui expose, celui qui sait, celui qui
    // garde — mais une plate-forme d'antennes n'a pas de barman, et une console
    // ne se laisse pas convaincre : ce qu'elle affiche se lit, point.
    const acquisition = this.scene.key_item.acquisition ?? 'informant_then_holder'

    if (acquisition === 'found') {
      if (item.npc_id !== FOUND_ITEM_ID) {
        throw new Error(
          `Scène invalide : objet à trouver, key_item.npc_id doit valoir "${FOUND_ITEM_ID}" `
          + `(reçu "${item.npc_id}")`)
      }
      // LA FRÉQUENCE A TROIS PIÈCES, et il les faut toutes dans le texte :
      // un objet qu'on ramasse, au moins deux choses à regarder (c'est la
      // deuxième qui donne la valeur), et le nom de la fréquence — c'est en le
      // déchiffrant à la loupe que s'ouvre le panneau du cadran. Sans ce nom,
      // il n'y avait rien à déchiffrer, et le panneau n'apparaissait jamais.
      const puzzle = this.scene.key_item.puzzle
      if (puzzle === 'frequency' || puzzle === 'code') {
        if (!written.includes(fold(item.name))) {
          throw new Error(
            `Scène invalide : "${item.name}" (key_item.name) n'apparaît pas dans scene_text — `
            + 'écris-le tel quel, en Majuscule, sur l\'élément focal : c\'est en le déchiffrant que le joueur ouvre le cadran')
        }
        const named = (label?: string) => Boolean(label) && written.includes(fold(label!))
        if (!takeable.some(o => !o.hidden && named(o.label))) {
          throw new Error(
            'Scène invalide : aucun objet à ramasser n\'est nommé dans scene_text — '
            + `nomme dans le texte, avec son label exact, au moins un objet de verbe ${this.takeVerbs}`)
        }
        if (surfacesOf(generated, this.lang).length < 2) {
          throw new Error(
            'Scène invalide : moins de deux choses à regarder sont nommées dans scene_text — '
            + 'nomme chaque élément de `decor` avec son nom exact, et au moins deux choses à examiner sans les prendre')
        }
      }
      return
    }

    // Un détenteur inconnu rendrait la sortie impossible à débloquer.
    if (!generated.npcs.some(n => n.id === item.npc_id)) {
      throw new Error(`Scène invalide : key_item.npc_id "${item.npc_id}" ne désigne aucun PNJ`)
    }
    if (acquisition === 'holder') return

    if (!item.informant_npc_id || item.informant_npc_id === item.npc_id) {
      throw new Error('Scène invalide : key_item.informant_npc_id doit désigner un AUTRE PNJ')
    }
    if (!generated.npcs.some(n => n.id === item.informant_npc_id)) {
      throw new Error(`Scène invalide : informant_npc_id "${item.informant_npc_id}" ne désigne aucun PNJ`)
    }
    // Le premier de la liste ouvre la scène : il expose, il ne résout rien.
    const host = generated.npcs[0]?.id
    if (host && (item.npc_id === host || item.informant_npc_id === host)) {
      throw new Error('Scène invalide : celui qui accueille ne peut être ni détenteur ni informateur')
    }
  }

  /**
   * Impose le résultat du formulaire avant validation et assemblage.
   *
   * Le prompt donne déjà ces valeurs au modèle pour que noms, cartes et prose
   * restent cohérents. Cette seconde barrière garantit que l'image et
   * l'interface ne varieront pas si le modèle recopie mal un hexadécimal.
   */
  pinPlayerPalette(generated: GeneratedScene, user: UserProfile): void {
    const exact = deterministicPaletteHexes(user, this.scene.id)
    if (generated.palette?.dominant) generated.palette.dominant.hex = exact.dominant
    if (generated.palette?.secondary) generated.palette.secondary.hex = exact.secondary
    if (generated.palette?.accent) generated.palette.accent.hex = exact.accent
  }

  /** Fusionne la sortie du modèle avec les parties statiques du script. */
  assembleText(
    generated: GeneratedScene,
    theme: PlayerTheme | null = null,
    carried: CarriedItem[] = [],
    journal: JournalEntry[] = [],
  ): SceneTextResponse {
    const exit = this.scene.exits[0]

    // Le modèle produit des couleurs qui ne tiennent pas la hiérarchie Dark Deco.
    // On les recale avant d'en dériver quoi que ce soit.
    const audit = enforceAccentVisibility(generated.palette)

    // Les parts affichées viennent du script, jamais du modèle : il renvoie
    // volontiers 60/30/10 par habitude, quel que soit le ratio demandé.
    const ratio = this.scene.art_direction.tonal_ratio
    const palette: ScenePalette = {
      dominant: { ...audit.palette.dominant, coverage_pct: ratio.dominant_pct },
      secondary: { ...audit.palette.secondary, coverage_pct: ratio.secondary_pct },
      accent: { ...audit.palette.accent, coverage_pct: ratio.accent_pct },
    }
    const scene = { ...generated, palette }

    // Les interactables obligatoires sont réinjectés même si le modèle les a oubliés.
    const interactables = [...(scene.interactables ?? [])]
    for (const forced of this.scene.interactables.always_include) {
      const existing = interactables.find(i => i.id === forced.id)
      if (existing) existing.triggers_paywall = forced.triggers_paywall
      else interactables.push(forced)
    }

    // LE PICTOGRAMME FINIT DANS LE DOM, et c'est le modèle qui l'a écrit. Il est
    // reconstruit ici, forme par forme, avant de quitter le serveur : ce que le
    // navigateur garde en stockage local est déjà propre. Un tracé dont rien ne
    // se sauve disparaît, et l'objet prend le symbole de sa nature.
    const drawn = <T extends { icon?: string }>(o: T): T =>
      o.icon === undefined ? o : { ...o, icon: sanitizeItemIcon(o.icon) }
    // UN IDENTIFIANT DÉJÀ EN POCHE NE SE REPREND PAS. L'inventaire dédoublonne
    // par id et le déchiffrage s'en souvient par id : le « carnet » d'ici, si
    // le joueur en porte un de l'auberge, ne se ramasserait pas et passerait
    // pour déjà lu. Plus il y a d'objets à prendre, plus le modèle réemploie
    // les mêmes mots — on renomme ce qui entre en collision, et ce qui le
    // désigne dans la scène avec. `wants.item_id`, lui, vise ce qu'il PORTE.
    const worn = new Set(carried.map(c => c.id))
    const fresh = (id: string) => (id && worn.has(id) ? `${id}_${this.scene.id}` : id)
    // UNE CARTE DE PLUS NE DOIT JAMAIS SE CONFONDRE. Même couleur que l'accent
    // d'ici, que la carte de ce lieu ou qu'une carte déjà en poche : au lecteur,
    // deux cartes pareilles rendraient l'indice ambigu. Elle reste ramassable,
    // mais redevient un objet de récit. Hors des lieux qui en posent une, le
    // modèle n'a rien à y mettre.
    const taken = new Set([
      palette.accent.name, generated.key_item?.color,
      ...carried.filter(c => c.kind === 'key').map(c => c.color),
    ].filter((c): c is string => Boolean(c?.trim())).map(fold))
    const carded = interactables.map((i) => {
      if (i.item_kind !== 'carte') return i
      const color = i.card_color?.trim()
      if (!this.scene.interactables.spare_card || !color || taken.has(fold(color))) {
        const { card_color: _c, card_hex: _h, ...rest } = i
        return { ...rest, item_kind: 'recit' as const }
      }
      taken.add(fold(color))
      return { ...i, card_color: color, card_hex: i.card_hex && HEX_RE.test(i.card_hex) ? i.card_hex : undefined }
    })
    const iconed = carded.map(i => drawn({ ...i, id: fresh(i.id) }))
    const npcs = (scene.npcs ?? []).map(n => !n.wants ? n : {
      ...n,
      wants: {
        ...n.wants,
        reveals_id: n.wants.reveals_id ? fresh(n.wants.reveals_id) : n.wants.reveals_id,
        reward_item: n.wants.reward_item
          ? drawn({ ...n.wants.reward_item, id: fresh(n.wants.reward_item.id) })
          : n.wants.reward_item,
      },
    })

    // La Majuscule de Titre est le seul signal d'interaction du jeu. Le modèle
    // l'applique à la liste `interactables` et l'oublie dans la prose : le même
    // objet y est « un tourniquet de contrôle », donc invisible comme objet.
    // La règle est dans le prompt depuis toujours et n'a jamais suffi — on la
    // fait respecter ici, sans un token de plus.
    const naming = enforceNameCaps(scene.scene_text, [
      ...interactables.map(i => i.label),
      ...(scene.decor ?? []).map(d => d.name),
      scene.place.name,
      scene.key_item?.name,
      scene.sealed_object?.name,
      // Les noms de personnes aussi : le récit les récite en capitales dans sa
      // dernière ligne, et un nom écrit de deux façons est deux choses
      // différentes pour tout ce qui le cherche ensuite.
      ...(scene.npcs ?? []).map(n => n.name),
    ].filter((n): n is string => Boolean(n)), this.lang)

    if (naming.fixed.length) {
      console.warn(`[scene/${this.scene.id}] majuscules recalées : ${naming.fixed.join(' · ')}`)
    }
    // Un nom déclaré que le texte ne prononce pas est un objet que le joueur ne
    // rencontrera jamais : la liste `interactables` promet ce que la prose ne
    // montre pas.
    if (naming.missing.length) {
      console.warn(`[scene/${this.scene.id}] déclarés mais absents du texte : ${naming.missing.join(' · ')}`)
    }

    const vars: Record<string, string> = {
      quest_title: scene.quest.title,
      quest_artifact: scene.quest.artifact,
      place_name: scene.place.name,
      // Montrées HORS fiction, au moment de payer la suite : ce qui se tend
      // chez lui, et vers quoi. Écrites par le plan, donc dans sa langue.
      tension: generated.night?.tension ?? '',
      release: generated.night?.release ?? '',
    }

    // Tirée APRÈS le recalage des majuscules : les indices se posent sur les
    // noms tels que le joueur les lira.
    const puzzle = drawPuzzle(this.scene.key_item.puzzle, {
      scene_id: this.scene.id,
      scene_text: naming.text,
      decor: scene.decor,
      interactables: iconed,
      key_item: generated.key_item,
    }, { lang: this.lang, carried, journal })
    // L'ÉNIGME DE FIN D'ACTE NE DOIT PAS TOMBER EN SILENCE. Sans elle, la scène
    // retombe sur la lecture à la loupe et le joueur ne voit jamais le panneau :
    // on veut le savoir, sinon rien ne distingue une scène ratée d'une scène
    // qui n'en avait pas.
    if (this.scene.key_item.puzzle && !puzzle) {
      const cards = carried.filter(c => c.kind === 'key' && c.id !== 'cle_auberge')
      console.warn(`[puzzle] ${this.scene.id} : « ${this.scene.key_item.puzzle} » non tiré, retour à la loupe`
        + ` (cartes en poche : ${cards.map(c => `${c.id}${c.color ? `/${c.color}` : '/sans couleur'}`).join(', ') || 'aucune'}`
        + `, gestes : ${generated.key_item?.steps?.length ?? 0})`)
    }

    return {
      ...scene,
      scene_text: naming.text,
      interactables: iconed,
      npcs,
      scene_id: this.scene.id,
      scene_title: this.title,
      exit_label: this.exitLabel,
      planned: this.plan,
      script_version: this.script.version,
      image_prompt: this.buildImagePrompt({
        place_name: scene.place.name,
        palette: scene.palette,
        decor: scene.decor,
      }),
      static_image: this.staticImage,
      // Seule l'auberge remet l'augmentation ; ailleurs l'objet-clé est une
      // carte, une fréquence, un code — utile ici et nulle part ailleurs.
      grants_augmentation: this.scene.objective?.kind === 'acquire_augmentation',
      // Le mode d'emploi de l'augmentation, monté avec les champs de l'objet.
      augmentation_primer: {
        ...this.script.defaults.augmentation_primer,
        ...this.localized('augmentation_primer', {}),
      },
      // L'oeil est une commande de l'interface : son texte est fixe, et il
      // n'entre jamais dans le prompt de la scène. Voir `defaults.eye_primer`.
      eye_primer: { ...this.script.defaults.eye_primer, ...this.localized('eye_primer', {}) },
      // Seule cette scène-là demande le paiement ; les suivantes s'enchaînent.
      is_paywall_gate: this.scene.is_paywall_gate === true,
      // Le client s'en sert pour teindre l'habillage. La scène 1 est en
      // `fixed` : son magenta est l'identité d'entrée du jeu.
      interface_palette: this.scene.interface_palette?.mode ?? 'from_scene',
      pacing: this.pacing,
      theme,
      puzzle,
      key_item: {
        ...drawn(generated.key_item),
        // UNE CARTE A TOUJOURS SA COULEUR. C'est par elle que le lecteur de fin
        // d'acte la réclame : une carte sans couleur ne peut plus y entrer, et
        // l'énigme tombait. Le modèle l'oublie parfois ; la couleur d'une carte
        // est l'accent de son lieu, on la lui rend.
        color: this.keyItemIsCard
          ? palette.accent.name
          : generated.key_item?.color?.trim(),
        exchanges_before_handover: this.scene.key_item.exchanges_before_handover,
        // Comment il s'obtient voyage avec la scène : le client doit savoir
        // qu'ici personne ne le tend, et que c'est le déchiffrage qui le donne.
        acquisition: this.scene.key_item.acquisition ?? 'informant_then_holder',
      },
      palette_audit: {
        adjusted: audit.adjusted,
        original_dominant: audit.original_dominant,
        original_secondary: audit.original_secondary,
        original_accent: audit.original_accent,
        contrast_vs_dominant: Number(audit.contrast_vs_dominant.toFixed(2)),
        contrast_vs_secondary: Number(audit.contrast_vs_secondary.toFixed(2)),
        base_contrast: Number(audit.base_contrast.toFixed(2)),
      },
      paywall: (() => {
        // Le paywall est du texte AFFICHÉ : il suit la langue du joueur, pas
        // celle du script. Le montant et la devise, eux, n'en changent pas —
        // le paiement est en euros où qu'on joue.
        const pw = {
          ...this.script.paywall,
          ...this.localized<Partial<typeof this.script.paywall>>('paywall', {}),
        }
        return {
          gate_text: interpolate(pw.gate_text, vars),
          cta: interpolate(pw.cta, vars),
          sub_cta: interpolate(pw.sub_cta, vars),
          amount_cents: this.script.paywall.amount_cents,
          currency: this.script.paywall.currency,
          // Ce que le client teste pour savoir si le joueur parle de sortir.
          // La MÊME liste que le serveur : deux listes se seraient
          // désynchronisées, et la porte se serait ouverte d'un côté seulement.
          exit_keywords: this.exitKeywords,
          min_turns_before_trigger: exit.min_turns_before_trigger,
          // Les variables de quête sont interpolées ici : le client n'a jamais
          // à connaître la syntaxe des gabarits.
          pitch: {
            eyebrow: pw.pitch.eyebrow,
            generative: pw.pitch.generative,
            // Un point dont une variable est vide n'afficherait que des
            // guillemets : sans plan, la tension ne se montre pas.
            points: pw.pitch.points
              .filter(pt => [...pt.text.matchAll(/{{(\w+)}}/g)].every(m => vars[m[1]!]))
              .map(pt => ({
              label: pt.label,
              text: interpolate(pt.text, vars),
            })),
            closing: interpolate(pw.pitch.closing, vars),
          },
        }
      })(),
    }
  }

  /**
   * Prompt système d'un tour de jeu : les faits de la scène, figés.
   *
   * Passé `steer_after_turns`, une consigne d'orientation vers la sortie est
   * ajoutée. Elle vient du script, jamais du client : c'est la même règle que
   * pour le reste du prompt.
   */
  buildTurnSystemPrompt(ctx: TurnContext, turnCount = 0): string {
    const t = this.scene.turn
    const npcList = ctx.npcs.length
      ? ctx.npcs.map(n => `${n.name} (${n.archetype})`).join(', ')
      : 'personne'

    const base = interpolate(t.system_prompt_template, {
      ...this.langVars,
      scene_title: this.title,
      player_name: ctx.player_name,
      place_name: ctx.place.name,
      place_reputation: ctx.place.reputation,
      quest_title: ctx.quest.title,
      quest_objective: ctx.quest.objective,
      quest_stakes: ctx.quest.stakes,
      quest_night_goal: ctx.night_goal ?? '',
      quest_artifact: ctx.quest.artifact,
      npc_list: npcList,
      narrative_instruction: `${this.scene.narrative.instruction}\n${this.vocabulary}\n${this.namingStyle}`,
      max_words: String(t.max_words),
      exit_label: this.exitLabel,
    })

    const agreed = ctx.player_agreement
      ? `${base}\n\n${interpolate(t.agreement_rule, { agreement: ctx.player_agreement })}`
      : base

    // Une énigme se lit dans le lieu : personne ne la résout à la place du
    // joueur, et surtout personne n'invente un chiffre que le jeu n'a pas tiré.
    const puzzleRule = this.scene.key_item.puzzle
      ? `\n\n${this.script.defaults.puzzles.turn_rules[this.scene.key_item.puzzle] ?? ''}`
      : ''

    const withItem = ctx.key_item
      ? `${agreed}${puzzleRule}\n\n${interpolate(this.itemIsFound ? t.key_item_context_found : t.key_item_context, {
          item_name: ctx.key_item.name,
          item_description: ctx.key_item.description,
          item_why: ctx.key_item.why,
          item_action: ctx.key_item.resolving_action || ctx.quest.restoration || ctx.quest.objective,
          item_handover_hint: ctx.key_item.handover_hint || "ce qu'il est vraiment sorti chercher cette nuit",
          item_holder: ctx.npcs.find(n => n.id === ctx.key_item?.npc_id)?.name ?? 'un habitué',
          exit_label: this.exitLabel,
        })}`
      : agreed

    const themed = ctx.theme?.sign
      ? `${withItem}\n\n${interpolate(this.script.zodiac.turn_instruction, { tension: ctx.theme.sign.tension })}`
      : withItem

    // La langue ferme le prompt système : c'est la dernière consigne lue, et
    // celle qu'un modèle applique le plus fidèlement.
    const spoken = `${themed}\n\n${this.playerCareBlock}\n\n${this.languageBlock}`

    if (turnCount < t.steer_after_turns) return spoken

    // Tant que l'objet manque, pousser vers le sas enverrait le joueur sur une
    // issue fermée : on l'oriente d'abord vers celui qui le détient.
    const item = ctx.key_item
    const nameOf = (id?: string) => ctx.npcs.find(n => n.id === id)?.name ?? 'un habitué'

    // Trois orientations selon l'endroit où le joueur est bloqué. Pousser vers
    // le détenteur avant qu'il connaisse la piste l'envoyait sur un personnage
    // programmé pour ne rien dire.
    let steer = t.steer_instruction
    if (item && !ctx.has_key_item && this.itemIsFound) {
      steer = t.steer_instruction_missing_found
    } else if (item && !ctx.has_key_item && !ctx.informed_about_item) {
      steer = interpolate(t.steer_instruction_missing_informant, {
        quest_title: ctx.quest.title,
        npc_name: nameOf(item.informant_npc_id),
      })
    } else if (item && !ctx.has_key_item) {
      steer = interpolate(t.steer_instruction_missing_item, {
        item_name: item.name,
        npc_name: nameOf(item.npc_id),
      })
    }

    return `${spoken}\n\n${steer}`
  }

  /**
   * Ce que le personnage fait, en plus de parler, au moment où il prend l'objet.
   *
   * Trois cas et jamais deux à la fois : il remet quelque chose, il découvre un
   * élément caché, ou il n'a que ce qu'il sait. Le troisième doit être dit
   * explicitement — sans lui, le modèle offre spontanément un objet qui
   * n'existe nulle part, et le joueur cherche ensuite dans son inventaire une
   * chose que personne ne lui a donnée.
   */
  private rewardRule(npc: SceneNPC, ctx: TurnContext): string {
    const t = this.scene.turn
    const wants = npc.wants
    const gift = wants?.reward_item
    if (gift?.label) return interpolate(t.give_reward_item_rule, { reward_label: gift.label })

    if (wants?.reveals_id) {
      // Le libellé vient de la scène générée, pas du script : les éléments
      // cachés sont écrits par le modèle, et le client nous les reporte.
      return interpolate(t.give_reveal_rule, {
        reward_label: ctx.reveal_label || wants.reveals_id,
      })
    }
    return t.give_reward_none_rule
  }

  /**
   * Le joueur porte-t-il encore cet objet ?
   *
   * `wants` est écrit à la génération, sur l'inventaire d'alors. Une fois
   * l'objet donné il n'y est plus, et le personnage continuerait à le
   * réclamer — ce qui ferait de lui un disque rayé.
   */
  private stillCarried(ctx: TurnContext, itemId: string): boolean {
    return ctx.carried_ids ? ctx.carried_ids.includes(itemId) : true
  }

  /** Prompt utilisateur : ambiance, relance vers la sortie, ou réplique d'un PNJ. */
  buildTurnUserPrompt(ctx: TurnContext, input: string, npc?: SceneNPC, mode?: TurnMode): string {
    const t = this.scene.turn

    /**
     * Les deux règles communes à toute réplique de personnage.
     *
     * Aucun prompt ne demandait de RÉPONDRE à ce que le joueur venait de dire :
     * ils passaient sa phrase puis donnaient aussitôt un ordre du jour, et l'un
     * d'eux ordonnait même de parler d'autre chose. D'où des personnages qui
     * dévisagent et enchaînent. Répondre d'abord, orienter ensuite.
     */
    const rules = {
      ...this.langVars,
      reply_rule: t.reply_rule ?? '',
      // Ce qui rend la conversation cumulative : le fil du personnage lui est
      // remis à part (voir `npcThreads`), et cette règle lui dit quoi en faire
      // — continuer, ne pas se répéter, en lâcher plus à mesure.
      thread_rule: t.thread_rule ?? '',
      steer_rule: interpolate(t.steer_rule ?? '', { quest_objective: ctx.quest.objective }),
      // Ce que ce personnage-là sait du dehors, et lui seul. Un PNJ sans
      // morceau assigné n'en invente pas un : la règle disparaît de son prompt.
      beyond_rule: npc?.beyond
        ? interpolate(t.beyond_rule ?? '', { npc_beyond: npc.beyond })
        : '',
      // Ce que ce personnage-là veut de ce que le joueur porte. Il se tait dès
      // que l'objet a changé de main : `offered_item` est alors consommé et
      // `wants` ne pointe plus sur rien que le joueur ait encore.
      wants_rule: npc?.wants?.item_id && this.stillCarried(ctx, npc.wants.item_id)
        ? interpolate(t.wants_rule ?? '', { npc_wants_hint: npc.wants.hint })
        : '',
    }

    if ((mode === 'give' || mode === 'give_refused') && npc && ctx.offered_item) {
      const template = mode === 'give' ? t.give_prompt : t.give_refused_prompt
      return interpolate(template ?? t.npc_dialogue_prompt, {
        ...rules,
        npc_name: npc.name,
        npc_archetype: npc.archetype,
        npc_personality: npc.personality,
        npc_knows: npc.knows,
        player_input: input,
        // Un objet dont le nom n'a jamais été déchiffré ne se nomme pas : ni le
        // joueur qui le tend ni celui qui le prend ne savent comment l'appeler.
        item_name: ctx.offered_item.known
          ? ctx.offered_item.name
          : "la chose qu'il porte sans en connaître le nom",
        item_reward: npc.wants?.reward ?? '',
        // Ce que l'échange fait AVANCER, en plus de ce qu'il dit : un objet
        // qu'il sort de sa poche, ou une chose du décor que personne ne voyait.
        // Le nom doit tomber dans sa réplique à la lettre près — c'est le seul
        // endroit où le joueur peut l'apprendre.
        reward_extra: mode === 'give' ? this.rewardRule(npc, ctx) : '',
      })
    }

    if (mode === 'handover' && npc && ctx.key_item) {
      return interpolate(t.handover_prompt, {
        ...rules,
        npc_name: npc.name,
        npc_archetype: npc.archetype,
        npc_personality: npc.personality,
        player_input: input,
        item_name: ctx.key_item.name,
        // La question qu'il avait posée : sa réplique commente la réponse
        // avant de remettre l'objet, elle ne la redemande pas.
        item_handover_hint: ctx.key_item.handover_hint || "ce qu'il est vraiment sorti chercher cette nuit",
        item_description: ctx.key_item.description,
        item_why: ctx.key_item.why,
        item_action: ctx.key_item.resolving_action || ctx.quest.restoration || ctx.quest.objective,
        exit_label: this.scene.exits[0]?.label ?? 'la sortie',
      })
    }

    if (mode === 'blocked_exit' && ctx.key_item) {
      return interpolate(this.itemIsFound ? t.blocked_exit_prompt_found : t.blocked_exit_prompt, {
        player_input: input,
        exit_label: this.scene.exits[0]?.label ?? 'la sortie',
        item_name: ctx.key_item.name,
        npc_name: ctx.npcs.find(n => n.id === ctx.key_item?.npc_id)?.name ?? 'un habitué',
      })
    }

    if (mode === 'exit_nudge') {
      return interpolate(t.exit_nudge_prompt, {
        player_input: input,
        exit_label: this.scene.exits[0]?.label ?? 'la porte',
        quest_artifact: ctx.quest.artifact,
        quest_title: ctx.quest.title,
      })
    }

    if (!npc) return interpolate(t.ambient_prompt, { player_input: input })

    const item = ctx.key_item
    const holderName = () => ctx.npcs.find(n => n.id === item?.npc_id)?.name ?? 'un habitué'

    // Deux ou trois échanges avant qu'il s'ouvre : un personnage qui livre ce
    // qu'il sait à la première réplique n'a aucune consistance. Avant ça il
    // parle vraiment, lâche au mieux un fragment, et jauge son interlocuteur.
    const warmedUp = (ctx.npc_exchanges ?? 0) >= (t.exchanges_before_steer ?? 2)

    if (item && !ctx.has_key_item && npc.id === item.informant_npc_id && !warmedUp) {
      return interpolate(t.informant_warmup_prompt, {
        ...rules,
        npc_name: npc.name,
        npc_archetype: npc.archetype,
        npc_personality: npc.personality,
        npc_knows: npc.knows,
        player_input: input,
        quest_title: ctx.quest.title,
      })
    }

    // L'informateur met sur la piste : c'est lui qui ouvre la chaîne.
    if (item && !ctx.has_key_item && npc.id === item.informant_npc_id) {
      return interpolate(t.informant_prompt, {
        ...rules,
        npc_name: npc.name,
        npc_archetype: npc.archetype,
        npc_personality: npc.personality,
        npc_knows: npc.knows,
        player_input: input,
        item_informant_hint: item.informant_hint || ctx.quest.hook,
        item_holder: holderName(),
      })
    }

    // Le détenteur avant que le joueur ait été informé : il parle, mais jamais
    // de ce qu'il garde. On peut l'aborder, on ne peut rien en tirer.
    if (item && !ctx.has_key_item && !ctx.informed_about_item && npc.id === item.npc_id) {
      return interpolate(t.holder_locked_prompt, {
        ...rules,
        npc_name: npc.name,
        npc_archetype: npc.archetype,
        npc_personality: npc.personality,
        npc_knows: npc.knows,
        player_input: input,
        quest_title: ctx.quest.title,
      })
    }

    // Le détenteur, une fois informé : il raconte, et il relance.
    if (item && !ctx.has_key_item && npc.id === item.npc_id) {
      return interpolate(t.holder_prompt, {
        ...rules,
        npc_name: npc.name,
        npc_archetype: npc.archetype,
        npc_personality: npc.personality,
        npc_knows: npc.knows,
        player_input: input,
        item_name: ctx.key_item.name,
        item_handover_hint: ctx.key_item.handover_hint || "ce qu'il est vraiment sorti chercher cette nuit",
        item_hook_story: ctx.key_item.hook_story || ctx.quest.hook,
        quest_title: ctx.quest.title,
      })
    }

    return interpolate(t.npc_dialogue_prompt, {
      ...rules,
      npc_name: npc.name,
      npc_archetype: npc.archetype,
      npc_personality: npc.personality,
      npc_knows: npc.knows,
      player_input: input,
      quest_title: ctx.quest.title,
    })
  }

  /**
   * Le libellé de la sortie de cette scène, dans la langue jouée.
   *
   * Il part au modèle — « la seule issue de ce lieu est … » — et il revient au
   * joueur, qui le tapera. Les deux doivent donc dire le même mot, et c'est
   * pour ça qu'il n'est résolu qu'ici.
   */
  get exitLabel(): string {
    return this.plan?.exit_label
      || (overlayValue<string>(this.lang, `exit_labels.${this.scene.id}`)
        ?? this.scene.exits[0]?.label
        ?? this.pack.ui['game.exit_opens'])
  }

  /**
   * Les mots par lesquels ce joueur-là ouvre la porte.
   *
   * Deux sources réunies. La liste du pack donne les verbes de la langue —
   * « go out », « salir », « wyjść ». Les mots du LIBELLÉ s'y ajoutent, parce
   * qu'une scène nomme sa sortie (« Le Funiculaire ») et qu'un joueur tape ce
   * qu'il lit : sans eux, seuls les verbes génériques auraient marché, et la
   * sortie nommée aurait été un leurre.
   *
   * Les `exits[].keywords` du script ne sont plus lus : ils étaient français,
   * et identiques d'une scène à l'autre. Le pack les remplace en douze langues.
   */
  private get exitKeywords(): string[] {
    const fromLabel = this.exitLabel
      .split(/[^\p{L}]+/u)
      .filter(w => w.length > 3)
      .map(w => w.toLowerCase())
    return [...this.pack.input.exit, ...fromLabel]
  }

  /** Le joueur parle-t-il de sortir, quel que soit le nombre de tours joués ? */
  mentionsExit(input: string): boolean {
    if (!this.scene.exits.length) return false
    return matchesKeyword(input, this.exitKeywords)
  }

  /** La commande du joueur déclenche-t-elle une sortie ? */
  matchExit(input: string, turnCount: number): SceneExit | null {
    const keywords = this.exitKeywords
    for (const exit of this.scene.exits) {
      if (turnCount < exit.min_turns_before_trigger) continue
      if (matchesKeyword(input, keywords)) return exit
    }
    return null
  }
}

/** Le script global. Porte les scènes et résout leurs defaults. */
export class ScriptRuntime {
  private readonly resolved = new Map<string, SceneRuntime>()

  constructor(readonly script: Script, readonly lang: LangCode = DEFAULT_LANG) {}

  /**
   * Le script, dans une langue.
   *
   * La langue est prise ICI et transmise à chaque scène, plutôt qu'ajoutée en
   * paramètre aux dix méthodes qui en ont besoin : le cache de scènes résolues
   * vit dans l'instance, donc une instance par langue et aucun mélange
   * possible. Les appelants qui n'affichent rien — le paiement, l'économie —
   * peuvent l'omettre et retombent sur le français.
   */
  static async load(lang: LangCode = DEFAULT_LANG): Promise<ScriptRuntime> {
    if (!script.scenes?.length) throw new Error('script.json ne contient aucune scène')
    return new ScriptRuntime(script, lang)
  }

  get version() { return this.script.version }
  get sceneIds() { return this.script.scenes.map(s => s.id) }

  /** Le paywall, texte d'affichage surchargé par la langue jouée. */
  get paywall() {
    return {
      ...this.script.paywall,
      ...(overlayValue<Partial<Script['paywall']>>(this.lang, 'paywall') ?? {}),
      // Jamais surchargés : le paiement est en euros où qu'on joue.
      amount_cents: this.script.paywall.amount_cents,
      currency: this.script.paywall.currency,
    }
  }

  /**
   * Les actes, titres traduits.
   *
   * L'accueil les affiche sous le bouton « Continuer » — « La Route »,
   * « Les Hauteurs ». Un joueur anglophone y lisait du français en pleine
   * reprise de partie.
   */
  get acts() {
    return this.script.acts.map(act => ({
      ...act,
      title: overlayValue<string>(this.lang, `act_titles.${act.id}`) ?? act.title,
    }))
  }

  /**
   * Les messages de quota et de fermeture, dans la langue du joueur.
   *
   * Ils partent en `statusMessage` d'une erreur HTTP, donc sans passer par un
   * composant : c'est le seul texte du jeu que le serveur écrit lui-même, et
   * il n'a que ce chemin-là pour être traduit.
   */
  get limits() {
    const over = overlayValue<Record<string, any>>(this.lang, 'limits') ?? {}
    const l = this.script.limits
    return {
      ...l,
      messages: { ...l.messages, ...over.messages },
      lock: { ...l.lock, ...over.lock },
      paid: { ...l.paid, messages: { ...l.paid.messages, ...over.paid?.messages } },
    }
  }

  /** Une scène par id. Sans argument, la scène de départ. */
  scene(id?: string): SceneRuntime {
    const sceneId = id ?? this.script.progression.start_scene
    const cached = this.resolved.get(sceneId)
    if (cached) return cached

    const raw = this.script.scenes.find(s => s.id === sceneId)
    if (!raw) {
      throw new Error(`Scène inconnue : "${sceneId}" (disponibles : ${this.sceneIds.join(', ')})`)
    }

    const runtime = new SceneRuntime(this.resolveDefaults(raw), this.script, this.lang)
    this.resolved.set(sceneId, runtime)
    return runtime
  }

  /** Applique `defaults`, que la scène peut surcharger bloc par bloc. */
  private resolveDefaults(raw: SceneScript): ResolvedScene {
    const d = this.script.defaults
    return {
      ...raw,
      art_direction: { ...d.art_direction, ...raw.art_direction },
      palette_derivation: { ...d.palette_derivation, ...raw.palette_derivation },
      // `structure` vient des defaults, `instruction` de la scène.
      quest: { ...d.quest, ...raw.quest },
      // Toutes les scènes en ont un ; l'auberge garde sa propre formulation.
      sealed_object: raw.sealed_object ?? d.sealed_object,
      narrative: { ...d.narrative, ...raw.narrative },
      turn: { ...d.turn, ...raw.turn },
      generation: { ...d.generation, ...raw.generation },
      interface_palette: { ...d.interface_palette, ...raw.interface_palette },
      error_fallbacks: d.error_fallbacks,
    }
  }
}
