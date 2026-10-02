/**
 * Le formulaire d'admission, et ce qu'il produit.
 *
 * Meta est sorti du jeu : le profil n'est plus déduit d'un compte, il est
 * DÉCLARÉ par le joueur. Ce fichier tient les deux bouts — la forme des
 * questions posées à l'écran, et la conversion vers `UserProfile`, la seule
 * forme que le reste du jeu connaisse (voir `describeUser` dans
 * utils/script-runtime.ts, qui en est le contrat réel).
 *
 * On ne demande QUE ce qui sert. L'inventaire, champ par champ :
 *   identity.first_name ........ nom d'usage en jeu, et NAMANK (accueil du monde)
 *   identity.last_name ......... avec le prénom : le namank du nom complet,
 *                                soit l'HÉRITAGE — ce que le nom traîne
 *   identity.*_latin ........... leur forme latine, demandée SEULEMENT quand
 *                                l'écriture du nom ne se calcule pas (chinois,
 *                                kanji) — sans elle, ni accueil ni héritage
 *   identity.birthday .......... signe du zodiaque, moolank, bhagyank, âge
 *   identity.agreement ......... accord des participes dans toute la narration
 *   origin.hometown ............ ville d'origine
 *   origin.current_location .... ville actuelle
 *   trajectory.turning_points .. LE tournant de vie — une seule ligne depuis le
 *                                2026-09-21, deux c'était trop
 *   touchstones ................ un moment auquel il tient, le film qui lui a
 *                                fait le plus peur, son animal préféré
 *   anthem ..................... un morceau, tenu en registre — jamais ses paroles
 *   imprints ................... quatre traces à remettre en décor
 *   nights ..................... les nuits sans sommeil, et le rêve qui revient
 *   misc_facts ................. divers
 * `identity.id` et `picture_url` ne servaient qu'à l'ancienne extraction Meta :
 * le formulaire ne les demande pas. Trois questions ont été retirées faute d'usage :
 * les langues parlées (le jeu se joue en une langue, choisie ailleurs), la
 * formation et le parcours professionnel — un intitulé de poste ne survit pas à
 * la transposition, le prompt interdisant toute reprise littérale. Les sources
 * de décor et la couleur secondaire qui en dépendaient tirent désormais sur
 * `imprints`.
 *
 * LES PASSIONS ONT ÉTÉ RETIRÉES le 2026-09-21. La première ligne demandait « ce
 * à quoi vous tenez le plus » et l'empreinte « un objet auquel vous tenez » :
 * deux fois la même question, et le joueur répondait deux fois la même chose.
 * Trois questions les remplacent, qui ne se recouvrent ni entre elles ni avec
 * les empreintes, parce que chacune a un rôle écrit dans la nuit
 * (`defaults.touchstones`, script.json) : le moment est ce que la nuit rend, le
 * film la forme de la menace, l'animal ce qui la traverse avec lui.
 *
 * TOUT SE SAISIT AU CLAVIER, sauf l'accord. Les grilles de touches — passions,
 * nuits, rêves — ont été retirées le 2026-09-09 : une touche est un mot que le
 * joueur n'a pas écrit, et le générateur ne peut rien transposer d'un
 * vocabulaire qu'il a lui-même fourni. Deux joueurs qui cochent « musique et
 * concerts » ont la même nuit ; deux joueurs qui l'écrivent, jamais. L'accord
 * grammatical reste en touches parce qu'il n'est pas une réponse mais un
 * réglage : trois valeurs, et le code les consomme telles quelles.
 */

import type { UserProfile, UserAgreement, UserNights } from '~/types/user'
import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { translate } from '~/utils/languages'
import { needsLatinName } from '~/utils/numerology'
import sampleJson from '../game/admission.json'

export interface AdmissionForm {
  /**
   * La langue de la nuit.
   *
   * Premier champ du dossier, et le seul qui agisse AVANT d'être déposé : le
   * changer retourne le formulaire lui-même. C'est voulu — on ne fait pas
   * remplir vingt lignes dans une langue pour jouer dans une autre, et le
   * joueur doit voir tout de suite ce qu'il vient de choisir.
   *
   * Elle part ensuite dans le profil, où elle décide de la génération.
   */
  language: LangCode
  /** Le prénom seul : c'est lui qu'on emploie en jeu, et lui qui porte le namank. */
  firstName: string
  /** Le nom de famille. Avec le prénom, il donne l'héritage. */
  lastName: string
  /**
   * Prénom et nom en lettres latines (pinyin, rōmaji). Le champ n'apparaît que
   * si le nom écrit n'a pas de lecture numérologique — voir `needsLatinName`.
   */
  firstNameLatin: string
  lastNameLatin: string
  /** `YYYY-MM-DD`, tel que le rend un `<input type="date">`. */
  birthday: string
  agreement: UserAgreement
  hometown: string
  currentCity: string
  /** Un moment auquel il tient. Ce que la nuit rend. */
  moment: string
  /** Le film qui lui a fait le plus peur. La forme de la menace. */
  fearFilm: string
  /** Son animal préféré. Ce qui traverse la nuit avec lui. */
  animal: string
  /** Un morceau qui compte. Le titre suffit. */
  anthemTitle: string
  /** Son artiste. Facultatif : le titre seul porte déjà genre et époque. */
  anthemArtist: string
  /** Une ligne libre, facultative. Il y en eut deux : c'était trop. */
  turningPoint: string
  /** Quatre traces personnelles, que la scène remettra en décor. */
  keepsake: string
  refuge: string
  ally: string
  aversion: string
  /** Ce qu'il fait les nuits où il ne dort pas. Ligne libre. */
  awakeNote: string
  /** Le rêve qui revient, dans ses mots. Ligne libre. */
  dreamNote: string
}

export function emptyAdmissionForm(lang: LangCode = DEFAULT_LANG): AdmissionForm {
  return {
    language: lang,
    firstName: '',
    lastName: '',
    firstNameLatin: '',
    lastNameLatin: '',
    birthday: '',
    agreement: 'masculin',
    hometown: '',
    currentCity: '',
    moment: '',
    fearFilm: '',
    animal: '',
    anthemTitle: '',
    anthemArtist: '',
    turningPoint: '',
    keepsake: '',
    refuge: '',
    ally: '',
    aversion: '',
    awakeNote: '',
    dreamNote: '',
  }
}

/**
 * Le dossier type : les réponses de game/admission.json, complétées des champs
 * qu'un ajout au formulaire n'y aurait pas encore mis.
 *
 * C'est la seule source du profil de démonstration — `loadUserFixture` le
 * convertit par `profileFromAdmission`, comme pour un vrai joueur — et c'est
 * aussi ce que le formulaire rouvre quand on est entré par le dossier type.
 */
export function sampleAdmissionForm(): AdmissionForm {
  const { _note, ...answers } = sampleJson as Partial<AdmissionForm> & { _note?: string }
  return { ...emptyAdmissionForm(), ...answers }
}

/**
 * Les libellés, amorces et exemples ne vivent pas ici : ce sont des textes
 * AFFICHÉS, et leur formulation change d'une langue à l'autre. Ils sont dans
 * les packs de langue, sous `admission.*`, et `AdmissionScreen.vue` les y prend.
 */

/** Âge révolu. Retourne undefined si la date est absente ou illisible. */
export function ageFrom(birthday: string): number | undefined {
  const [y, m, d] = birthday.split('-').map(Number)
  if (!y || !m || !d || y < 1900) return undefined
  const now = new Date()
  let age = now.getFullYear() - y
  const month = now.getMonth() + 1
  if (month < m || (month === m && now.getDate() < d)) age--
  return age >= 0 && age < 130 ? age : undefined
}

/**
 * « 1990-03-07 » → « 7 mars ». Pour la ligne « Né(e) le » des divers.
 *
 * Reste EN FRANÇAIS quelle que soit la langue jouée, et ce n'est pas un oubli :
 * `misc_facts` ne s'affiche nulle part, il part au modèle, au milieu d'un
 * prompt français. Le traduire n'aurait servi personne et aurait mis un mot
 * étranger là où tout le reste de la consigne est d'une seule langue.
 */
function frenchDay(birthday: string): string | null {
  const [, m, d] = birthday.split('-').map(Number)
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  if (!m || !d || !months[m - 1]) return null
  return `${d} ${months[m - 1]}`
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

/**
 * Ce qui a fait bifurquer le joueur.
 *
 * Sa ligne passe en premier — c'est lui qui parle. Le
 * déménagement est DÉDUIT : sans lui, un dossier rempli à la va-vite ne
 * donnerait aucune trajectoire au modèle.
 */
function turningPoints(form: AdmissionForm): string[] {
  const points = [clean(form.turningPoint)].filter(Boolean)

  const hometown = clean(form.hometown)
  const city = clean(form.currentCity)
  if (hometown && city && hometown.toLowerCase() !== city.toLowerCase()) {
    points.push(`A quitté ${hometown} pour ${city}`)
  }

  return points
}

function miscFacts(form: AdmissionForm): string[] {
  const facts: string[] = []
  const day = form.birthday ? frenchDay(form.birthday) : null
  // Accordé, tant qu'à faire : c'est la première phrase que le modèle lit sur
  // lui, ce serait bête d'y écrire « Né(e) ».
  const born = { masculin: 'Né', feminin: 'Née', neutre: 'Venu·e au monde' }[form.agreement]
  if (day) facts.push(`${born} un ${day}`)
  return facts
}

/** Les traces non vides, et rien d'autre : un champ vide vaut moins que rien. */
function imprints(form: AdmissionForm): UserProfile['imprints'] {
  const traces = {
    keepsake: clean(form.keepsake) || undefined,
    refuge: clean(form.refuge) || undefined,
    ally: clean(form.ally) || undefined,
    aversion: clean(form.aversion) || undefined,
  }
  return Object.values(traces).some(Boolean) ? traces : undefined
}

/**
 * Les trois repères, et rien si l'étape a été traversée sans rien écrire.
 *
 * Une ligne chacun, gardée telle quelle : c'est `describeUser` qui y colle la
 * consigne, et `defaults.touchstones` (script.json) qui dit à quoi chacun sert
 * dans la nuit.
 */
function touchstones(form: AdmissionForm): UserProfile['touchstones'] {
  const declared = {
    moment: clean(form.moment) || undefined,
    fear_film: clean(form.fearFilm) || undefined,
    animal: clean(form.animal) || undefined,
  }
  return Object.values(declared).some(Boolean) ? declared : undefined
}

/**
 * Le morceau, s'il en a donné un.
 *
 * Sans titre, pas de champ : un artiste seul ne dit rien de plus qu'un genre.
 */
function anthem(form: AdmissionForm): UserProfile['anthem'] {
  const title = clean(form.anthemTitle)
  if (!title) return undefined
  return { title, artist: clean(form.anthemArtist) || undefined }
}

/**
 * Les nuits déclarées, et rien si l'étape a été traversée sans rien écrire.
 *
 * Deux lignes libres, et plus aucune touche. La question reste posée en
 * CONDITIONNEL — « les nuits où vous ne dormez pas », pas « quel dormeur
 * êtes-vous » : un état n'appelle rien de la part de qui dort bien, un
 * conditionnel parle à tout le monde. Ce que le joueur écrit se passe DEHORS,
 * et le formulaire le lui dit : le jeu est une nuit dans une ville, un quai ou
 * un dernier bar donnent un décor, une heure et une raison d'être là, le
 * plafond d'une chambre ne donne rien à fabriquer.
 *
 * Le rêve demandé est celui qui REVIENT, jamais le dernier cauchemar : un
 * joueur sur deux ne s'en souvient pas, et un rêve récurrent est un motif
 * qu'une scène peut reposer aux dix tableaux sans lasser.
 */
function nights(form: AdmissionForm): UserProfile['nights'] {
  const declared: UserNights = {
    awake_note: clean(form.awakeNote) || undefined,
    dream_note: clean(form.dreamNote) || undefined,
  }
  return Object.values(declared).some(Boolean) ? declared : undefined
}

/**
 * Le dossier d'admission, converti dans la forme que le jeu consomme.
 *
 * Tout champ laissé vide disparaît du profil plutôt que d'y entrer vide : le
 * bloc joueur saute les lignes absentes, et une ligne « Formation :  » vaut
 * moins que pas de ligne du tout.
 */
export function profileFromAdmission(form: AdmissionForm): UserProfile {
  const firstName = clean(form.firstName)
  const lastName = clean(form.lastName)
  const fullName = [firstName, lastName].filter(Boolean).join(' ')
  const hometown = clean(form.hometown)
  const city = clean(form.currentCity)

  return {
    // La langue voyage AVEC le dossier, pas seulement dans le cookie : une
    // partie reprise depuis un autre appareil garde ainsi la sienne.
    language: form.language,
    identity: {
      name: fullName || translate(form.language, 'admission.unnamed'),
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      // Gardés seulement s'ils servent : un nom latin se pèse déjà tout seul.
      first_name_latin: (needsLatinName(firstName) && clean(form.firstNameLatin ?? '')) || undefined,
      last_name_latin: (needsLatinName(lastName) && clean(form.lastNameLatin ?? '')) || undefined,
      birthday: form.birthday || undefined,
      age: form.birthday ? ageFrom(form.birthday) : undefined,
      agreement: form.agreement,
    },
    origin: {
      hometown: hometown ? { name: hometown } : undefined,
      current_location: city ? { name: city } : undefined,
    },
    trajectory: {
      turning_points: turningPoints(form),
    },
    touchstones: touchstones(form),
    anthem: anthem(form),
    imprints: imprints(form),
    nights: nights(form),
    misc_facts: miscFacts(form),
  }
}
