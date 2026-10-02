// Forme normalisée du profil joueur. Produite par utils/admission.ts à partir
// du formulaire d'admission ; game/admission.json en tient le dossier type.

import type { LangCode } from '~/types/i18n'

export type PassionIntensity = 'high' | 'medium' | 'low'

export interface UserPassion {
  theme: string
  intensity: PassionIntensity
  evidence: string[]
}

export interface UserPlace {
  name: string
  /**
   * Enrichissement local : le formulaire ne demande qu'un nom de ville.
   * Ni le formulaire ni le dossier type n'en portent plus.
   */
  traits?: string[]
}

/**
 * Accord grammatical du joueur.
 *
 * Le jeu narre à la deuxième personne, en français : sans cette information le
 * modèle tranche tout seul, et il tranche au masculin. « Tu es entré » pour
 * une joueuse, c'est le monde qui cesse d'être le sien.
 */
export type UserAgreement = 'masculin' | 'feminin' | 'neutre'

/**
 * Quatre traces personnelles, qui n'existent que pour être remises en décor.
 *
 * Ce ne sont pas des données d'état civil : c'est ce à quoi la nuit va
 * s'accrocher — un objet qui traîne sur une table, un lieu qui ressemble à un
 * refuge, un nom qui revient dans la bouche d'un inconnu, une chose qui hérisse
 * le joueur et que la scène va lui mettre sous le nez.
 */
export interface UserImprints {
  /** Un objet auquel il tient. */
  keepsake?: string
  /** L'endroit où il va quand ça ne va pas. */
  refuge?: string
  /** Quelqu'un qui compte. Prénom seul. */
  ally?: string
  /**
   * Ce qu'il ne supporte pas. PAS une peur — la peur, c'est le film : ceci est
   * la règle qu'on lui oppose dans chaque acte et qu'il refuse à l'acte III.
   */
  aversion?: string
}

/**
 * Un morceau qui compte pour le joueur.
 *
 * Le SON DE LA NUIT (depuis le 2026-09-21) : entendu sans être reconnu à
 * l'auberge, haché en boucles dehors, joué en entier au dernier lieu et à
 * l'aube — une chanson dure, et c'est ce que la ville ne laisse plus finir.
 * Voir `defaults.touchstones`. Jamais les paroles : le prompt interdit déjà toute reprise littérale, et un
 * modèle sommé de restituer un texte protégé répond mal ou refuse. L'artiste
 * est facultatif — le titre seul porte déjà un genre et une époque, ce qui
 * suffit à choisir la musique d'un lieu.
 */
export interface UserAnthem {
  title: string
  artist?: string
}

/**
 * L'emploi de ses nuits.
 *
 * La seule partie du dossier qui ne consigne pas un fait mais un imaginaire :
 * aucun profil publicitaire ne l'a jamais su, et le joueur ne l'a jamais écrit
 * nulle part.
 *
 * La question est CONDITIONNELLE, et ça change tout : on ne demande pas quel
 * dormeur il est — un état, dont beaucoup n'ont rien à dire — mais ce qu'il
 * fait les nuits où il ne dort pas. Tout le monde en a, y compris ceux qui
 * dorment bien, et la réponse est un GESTE, pris DEHORS : le jeu est une nuit
 * dans une ville, un quai ou un dernier bar lui donnent un décor, une heure et
 * une raison d'être là ; le plafond d'une chambre ne lui donne rien. Les deux
 * champs sont des LIGNES LIBRES : les touches proposées ici jusqu'au
 * 2026-09-09 rendaient au générateur le vocabulaire qu'il avait fourni, quand
 * c'est justement de mots qui ne sont pas les siens qu'il a besoin.
 * Le rêve, lui, est le seul élément du dossier
 * qui a le droit de reparaître à chaque scène sans lasser : puisqu'il REVIENT,
 * c'est un motif et pas une anecdote.
 */
export interface UserNights {
  /** Ce qu'il fait les nuits où il ne dort pas, dans ses mots. */
  awake_note?: string
  /** Le rêve qui revient, dans ses mots. */
  dream_note?: string
}

/**
 * Trois repères, qui remplacent les trois lignes de passions (2026-09-21).
 *
 * Les passions demandaient « ce à quoi vous tenez » et rentraient en conflit
 * avec l'objet des empreintes : deux fois la même question, deux fois la même
 * réponse. Ces trois-là ne se recouvrent pas, parce que chacune tient un RÔLE
 * différent dans la nuit — voir `defaults.touchstones` dans script.json :
 *   - le moment est ce que la nuit rend : un morceau de temps vécu, dans une
 *     ville qui l'a découpé (voir le thème profond) ;
 *   - le film donne la forme de la menace — sa MÉCANIQUE de peur, jamais le
 *     film lui-même ;
 *   - l'animal traverse toute la nuit avec lui, une silhouette par lieu.
 * Aucun ne demande au joueur de s'analyser : un moment, un titre, une bête, ça
 * se répond en trois secondes et ça ne se répond jamais pareil.
 */
export interface UserTouchstones {
  /** Un moment auquel il tient, dans ses mots. */
  moment?: string
  /** Le film qui lui a fait le plus peur. Le titre suffit. */
  fear_film?: string
  /** Son animal préféré. */
  animal?: string
}

export interface UserProfile {
  identity: {
    id?: string
    /** Prénom et nom réunis. C'est le nom du dossier, et celui qu'on affiche. */
    name: string
    /**
     * Le prénom seul.
     *
     * C'est LUI que les personnages emploient, et lui qui porte le namank : la
     * numérologie indienne pèse le nom par lequel on est appelé, pas l'état
     * civil complet.
     */
    first_name?: string
    last_name?: string
    picture_url?: string
    birthday?: string
    age?: number
    /** Comment accorder ce qu'on lui adresse. */
    agreement?: UserAgreement
  }
  /**
   * La langue dans laquelle cette nuit s'écrit.
   *
   * DÉCLARÉE, jamais devinée à ce stade : le sélecteur du formulaire propose
   * bien la langue du navigateur, mais c'est le joueur qui tranche, et son
   * choix voyage avec le dossier. Sans ce champ, le serveur retomberait sur le
   * cookie — qui suffit pour l'habillage, mais pas pour une partie reprise sur
   * un autre appareil, où le dossier arrive seul.
   *
   * Optionnelle parce qu'un dossier gardé d'avant le multilangue peut ne pas
   * l'avoir : son absence vaut français.
   */
  language?: LangCode
  origin: {
    hometown?: UserPlace
    current_location?: UserPlace
  }
  /**
   * Ce qui a fait bifurquer le joueur.
   *
   * Il y avait ici une formation et un parcours professionnel : le formulaire
   * ne les demande plus. Un intitulé de poste et un nom d'école ne survivaient
   * pas à la transposition — le prompt interdit toute reprise littérale, et il
   * n'en restait qu'une enseigne. Les empreintes ont pris leur place partout
   * où elles servaient de source, y compris pour la couleur secondaire.
   */
  trajectory: {
    turning_points: string[]
  }
  /**
   * Les anciennes passions. Le formulaire ne les demande plus et le récit ne
   * les lit plus : le champ ne reste que pour l'extraction Meta, débranchée.
   */
  passions?: UserPassion[]
  /** Un moment, un film qui fait peur, un animal. Voir UserTouchstones. */
  touchstones?: UserTouchstones
  /** Un morceau, tenu en registre. Voir UserAnthem : jamais de paroles. */
  anthem?: UserAnthem
  imprints?: UserImprints
  /** Ce qu'il fait de ses nuits, et le rêve qui revient. */
  nights?: UserNights
  misc_facts?: string[]
}
