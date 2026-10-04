/**
 * Une langue du jeu, et tout ce qu'il faut pour y jouer.
 *
 * Le jeu n'a longtemps parlé que français, et cette langue n'était écrite nulle
 * part : elle était RÉPARTIE. Les consignes de génération la nommaient en clair
 * (« en français »), l'accord des participes vivait dans `utils/agreement.ts`,
 * le lexique imposé dans `game/script.json`, les mots par lesquels un joueur
 * ouvre une porte dans les `exits[].keywords` de chaque scène, les verbes de
 * prise dans `utils/interactables.ts`, et l'habillage en dur dans les
 * composants. Traduire le jeu, ce n'était donc pas traduire un fichier : c'était
 * retrouver douze endroits.
 *
 * Un pack de langue les réunit. C'est le SEUL endroit où une langue s'écrit, et
 * il en faut un par langue proposée — sans exception, `scripts/check-lang.mjs`
 * refuse un pack auquel il manque une clé.
 *
 * LE SIGNAL D'INTERACTION DÉPEND DE L'ÉCRITURE. Ce qui se touche porte une
 * marque, le reste est du décor. Dans les écritures à casse, cette marque est
 * la Majuscule de Titre — c'est écrit dans `narrative.naming_style`, et
 * `utils/naming.ts` la fait respecter après coup. Le chinois, le japonais et
 * l'arabe n'ont pas de casse : la marque y devient le GRAS, posé par
 * l'interface sur les noms que la scène déclare (voir `LangWriting`). Le
 * modèle n'a qu'à écrire ces noms à l'identique ; il ne met jamais rien en
 * gras lui-même.
 */

import type { UserAgreement } from '~/types/user'

/**
 * Les langues jouables.
 *
 * L'ordre est celui du sélecteur : le français d'abord parce que c'est la
 * langue d'écriture du jeu, l'anglais ensuite, puis par nombre de locuteurs.
 */
export const LANG_CODES = [
  'fr', 'en', 'es', 'pt', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'id', 'vi',
  'zh', 'ja', 'ar',
] as const

export type LangCode = typeof LANG_CODES[number]

/** La langue d'écriture du jeu, et le repli de tout ce qui manque. */
export const DEFAULT_LANG: LangCode = 'fr'

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && (LANG_CODES as readonly string[]).includes(value)
}

/**
 * Ce qu'une langue dit au modèle.
 *
 * Les CONSIGNES, elles, restent en français : elles sont longues, précises, et
 * les retraduire douze fois reviendrait à maintenir douze scripts qui
 * divergeraient au premier ajustement. Un modèle lit une consigne française et
 * répond en polonais sans difficulté — à condition qu'on le lui dise fort, et
 * c'est exactement ce que porte ce bloc.
 */
export interface LangGeneration {
  /**
   * Le nom de la langue EN FRANÇAIS, pour les consignes qui la nomment
   * (« Invente le nom du bar en {{language}} »).
   */
  name_fr: string
  /**
   * La directive de sortie, écrite DANS la langue cible.
   *
   * Placée en tête du prompt utilisateur et rappelée dans le système. Elle est
   * dans la langue visée volontairement : une phrase anglaise au milieu d'un
   * prompt français est le signal le plus net qu'on puisse donner à un modèle
   * sur la langue attendue.
   */
  directive: string
  /**
   * L'accord grammatical, une formulation par valeur déclarée.
   *
   * L'étiquette ne suffit jamais — l'exemple porte mieux que la règle. Dans les
   * langues sans accord de participe (anglais, turc, indonésien, vietnamien),
   * la ligne dit au modèle ce qui, LÀ, marque le genre : un pronom, un nom de
   * métier, une forme d'adresse.
   */
  agreement: Record<UserAgreement, string>
  /**
   * Comment se nomme un lieu dans cette langue.
   *
   * Les scènes imposent des formes françaises — « La Rue … », « Le Carrefour … ».
   * Transposées mot à mot elles sonnent faux ailleurs ; cette ligne dit au
   * modèle de garder l'INTENTION de la forme, pas ses articles.
   */
  naming_form: string
  /**
   * Ce qui, DANS CETTE LANGUE, fait que la majuscule reste un signal.
   *
   * La règle générale — ce qui se touche prend la Majuscule de Titre, le reste
   * est en minuscules — suppose une langue où un nom commun s'écrit en
   * minuscules. L'allemand n'en est pas une : il capitalise TOUS les noms, et
   * le contraste disparaît. Le signal y devient donc l'adjectif — un objet
   * ordinaire est « ein schwerer Riegel », un objet manipulable « der Schwere
   * Riegel ». C'est la même idée, portée par le seul mot qui puisse encore la
   * porter.
   *
   * Les autres langues n'ont ici qu'un rappel : cette ligne est lue par le
   * modèle juste après `narrative.naming_style`, et c'est le dernier mot.
   */
  caps_note: string
  /**
   * Le lexique imposé : le monde est cyberpunk, pas médiéval.
   *
   * Chaque langue a ses propres faux amis. Le mot de la sortie compte plus que
   * les autres : c'est lui que le joueur tapera, et il doit coïncider avec
   * `input.exit` et avec les libellés de `script.exit_labels`.
   */
  vocabulary: string
  /**
   * La deuxième personne à employer.
   *
   * Le jeu tutoie. Toutes les langues n'ont pas de tutoiement, et celles qui en
   * ont ne l'emploient pas au même endroit : cette ligne tranche pour le modèle
   * plutôt que de le laisser hésiter d'une réplique à l'autre.
   */
  address: string
}

/**
 * Ce que le joueur peut TAPER, et que le jeu doit reconnaître sans appeler le
 * modèle.
 *
 * C'est la moitié du travail qu'on n'attend pas d'une traduction. Un joueur
 * anglophone tape « go outside » : sans ces listes, `matchesKeyword` ne trouve
 * rien, la sortie ne s'ouvre jamais et la partie est bloquée pour de bon.
 *
 * Les formes fléchies sont ÉCRITES, pas devinées : « sors », « sortir »,
 * « sortons ». Une racine tronquée attraperait des mots voisins, et le jeu
 * ouvrirait la porte sur « je sors mon briquet ».
 */
export interface LangInput {
  /** Franchir la sortie. La liste la plus longue : c'est la seule issue. */
  exit: string[]
  /**
   * Franchir la sortie, pendant qu'on parle à quelqu'un.
   *
   * `exit` ratisse large — « suis », « va », « entre », « la nuit » — et c'est
   * voulu quand le joueur est seul face au décor. En pleine conversation, les
   * mêmes mots sont ceux d'une réponse : « je suis prêt à sacrifier ma nuit »
   * fermait l'échange et partait en sortie bloquée, et le détenteur reposait
   * sa question sans fin. Ici, seuls les départs sans équivoque.
   */
  exit_strict: string[]
  /** Ramasser. Décide du bouton « Ramasser » et de ce qui se chiffre. */
  take: string[]
  /** S'adresser à quelqu'un. Sert à repérer qu'on parle sans nommer personne. */
  address: string[]
  /** « Je fais quoi ? » — l'oracle répond sans rien facturer. */
  guidance: string[]
  /** Examiner. La description est déjà écrite : elle ne se régénère pas. */
  look: string[]
  /**
   * Formulations par lesquelles on met fin à une conversation.
   *
   * Des PHRASES et non des verbes : « je pars » clôt un échange, « partir »
   * tout seul vise la sortie. C'est la différence entre quitter quelqu'un et
   * quitter le lieu, et elle décide qui répond au tour suivant.
   */
  leave: string[]
  /**
   * Fouiller un endroit — plonger la main, pas seulement regarder. Seul geste
   * de la fouille qui coûte la nuit : « regarder » lit l'indice gratuitement.
   */
  search: string[]
  /**
   * Verbes qui portent sur le monde et non sur quelqu'un.
   *
   * Combinés au nom d'un élément de décor, ils disent que le joueur s'est
   * détourné de son interlocuteur. Distincts de `look` et `take`, qui sont
   * déjà testés ailleurs : ici, ce qui manipule — ouvrir, pousser, allumer.
   */
  world: string[]
  /**
   * Les articles qu'un nom déclaré traîne, à retirer avant de le chercher.
   * Vide dans les langues qui n'en ont pas (russe, polonais, turc, indonésien,
   * chinois, japonais).
   */
  articles: string[]
  /** Mots vides, ignorés quand on cherche un nom dans une phrase. */
  stopwords: string[]
}

/**
 * L'habillage, clé par clé.
 *
 * Volontairement PLAT : une clé imbriquée se cherche à trois endroits et se
 * vérifie mal. `scripts/check-lang.mjs` compare les jeux de clés entre packs,
 * et il ne peut le faire simplement que sur du plat.
 */
export type LangUi = Record<string, string>

/**
 * La surcharge de `game/script.json` — et rien de plus.
 *
 * Le script reste la source des CONSIGNES et de la structure. Ce bloc ne
 * reprend que ce qui s'AFFICHE : les replis d'erreur, les deux fenêtres
 * d'explication, le paywall, les messages de quota et de fermeture, les titres.
 *
 * Il est partiel par nature, et `fr.json` le laisse vide : `game/script.json`
 * EST la version française. Le recopier là-bas créerait deux vérités qui
 * divergeraient au premier ajustement.
 */
export interface LangScript {
  error_fallbacks?: Record<string, string>
  augmentation_primer?: Record<string, unknown>
  eye_primer?: Record<string, unknown>
  paywall?: Record<string, unknown>
  limits?: Record<string, unknown>
  /** Titre affiché de chaque scène, par identifiant de scène. */
  scene_titles?: Record<string, string>
  /** Titre de chaque acte, par identifiant d'acte. */
  act_titles?: Record<string, string>
  /** Libellé de la sortie de chaque scène, par identifiant de scène. */
  exit_labels?: Record<string, string>
}

/**
 * Ce que l'écriture permet, et ce qu'elle interdit.
 *
 * Absent, le pack est une écriture à casse, de gauche à droite, mots séparés
 * par des espaces — le cas des douze premières langues.
 */
export interface LangWriting {
  /**
   * Comment se signale ce qui se touche.
   *
   * `caps` : la Majuscule de Titre, écrite par le modèle et recalée par
   * `enforceNameCaps`. `bold` : l'écriture n'a pas de casse ; le modèle écrit
   * les noms déclarés à l'identique. Dans les deux cas, `NarrativeText` met
   * en gras ce qui se touche.
   */
  signal: 'caps' | 'bold'
  /** Sens d'écriture. `rtl` pour l'arabe : il pilote `dir` sur le document. */
  dir?: 'ltr' | 'rtl'
}

export interface LanguagePack {
  code: LangCode
  /** Le nom de la langue DANS cette langue. C'est lui qu'affiche le sélecteur. */
  endonym: string
  /** Balise BCP-47, pour l'attribut `lang` du document. */
  tag: string
  writing?: LangWriting
  generation: LangGeneration
  input: LangInput
  ui: LangUi
  script?: LangScript
}
