import { normalize, matchesKeyword, hasWord, isDense, significant } from '~/utils/text-match'
import type { Interactable } from '~/types/scene'
import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { pack } from '~/utils/languages'

/**
 * Ce qui, dans une scène, s'ACQUIERT.
 *
 * La distinction compte deux fois, et il fallait donc qu'elle n'existe qu'une :
 * elle décide du bouton « Ramasser » qui apparaît sous le récit, et de ce qui
 * se chiffre dans le texte. Les deux listes doivent être la même — un objet
 * qu'on peut prendre sans qu'il soit chiffré s'attrape sans avoir été lu, un
 * objet chiffré qu'on ne peut pas prendre est une promesse en l'air.
 *
 * Le décor ordinaire n'en fait pas partie : on ne ramasse pas une voûte de
 * béton, et la chiffrer noierait le signal sous le mobilier.
 */

/**
 * L'objet se ramasse-t-il ? La sortie, qui déclenche le paywall, n'en est pas un.
 *
 * Le VERBE vient du modèle, donc dans la langue jouée : la liste à laquelle on
 * le compare doit y être aussi. Elle était française en dur — ce qui, hors
 * français, n'aurait rendu AUCUN objet ramassable, et le bouton « Ramasser »
 * n'aurait jamais paru.
 */
export function isTakeable(obj: Interactable, lang: LangCode = DEFAULT_LANG): boolean {
  if (obj.triggers_paywall) return false
  const verb = normalize(obj.verb ?? '')
  // Le modèle écrit parfois le verbe avec son complément — « prendre le
  // badge ». Il se ramasse tout autant : on compare le début, mot entier.
  return pack(lang).input.take.some(v => {
    const take = normalize(v)
    // Sans espace en chinois ou en japonais : « 拿起徽章 » commence par « 拿起 ».
    return verb === take || verb.startsWith(isDense(take) ? take : `${take} `)
  })
}

/**
 * Ce que la scène montre À CET INSTANT.
 *
 * Un élément `hidden` n'existe pas tant qu'un échange ne l'a pas découvert : il
 * n'est ni brouillé dans le récit, ni ramassable, ni compté par l'oracle. Sans
 * ce filtre, le jeu chiffrerait dans le texte d'ouverture le nom d'une trappe
 * que personne n'a encore montrée — et signalerait au joueur une chose qu'il
 * n'a aucun moyen d'atteindre.
 */
export function visible(objects: Interactable[] = [], revealed: string[] = []): Interactable[] {
  return objects.filter(o => !o.hidden || revealed.includes(o.id))
}

/** Une chose du récit que la loupe peut ouvrir. */
export interface Analyzable {
  id: string
  label: string
  /** Ce que l'analyse révèle. Vide : l'objet se déchiffre, mais n'apprend rien. */
  observation?: string
}

/**
 * Tout ce qui, dans une scène, se chiffre dans le texte et s'ouvre à la loupe.
 *
 * UNE SEULE LISTE, parce qu'elle sert deux endroits qui ne doivent jamais
 * diverger : ce que le récit brouille, et ce que la sortie de l'auberge exige
 * qu'on ait lu. Deux listes séparées, et le joueur se retrouverait devant une
 * porte qui réclame l'analyse d'un objet qu'aucun texte n'a chiffré.
 *
 * L'objet-clé en fait partie — il est brouillé dans le récit avant d'être
 * remis. Ailleurs, où l'objet-clé est une carte, le déchiffrer donne son nom
 * et rien d'autre.
 *
 * L'AUGMENTATION EST LA SEULE EXCEPTION, et elle est absolue : son nom est en
 * clair d'un bout à l'autre. C'est avec elle qu'on déchiffre — la brouiller
 * revenait à demander au joueur d'ouvrir l'outil avec lui-même. Sa majuscule
 * suffit à dire qu'il y a là quelque chose ; ce qu'il en fait, c'est la
 * chercher parmi les gens, pas la lire. En l'excluant ici on l'ôte des deux
 * usages d'un coup : le récit ne la brouille plus, et la porte du sas continue
 * d'exiger qu'on ait ouvert un AUTRE nom — sans quoi elle se serait ouverte
 * toute seule.
 */
export function analyzables(scene: {
  scene_id?: string
  key_item?: { name?: string; observation?: string } | null
  /** Cette scène remet l'augmentation : son objet-clé ne se brouille pas. */
  grants_augmentation?: boolean
  sealed_object?: { id: string; name?: string; observation?: string } | null
  interactables?: Interactable[]
}, lang: LangCode = DEFAULT_LANG, revealed: string[] = []): Analyzable[] {
  const out: Analyzable[] = []
  // Le nom de l'augmentation, soudé, pour la reconnaître où que le modèle
  // l'ait recopiée. S'il la glisse aussi dans l'objet scellé ou parmi les
  // ramassables, le filtre de `key_item` ne sert à rien : le récit la
  // brouillerait par une autre porte.
  const augmentation = scene.grants_augmentation ? bare(scene.key_item?.name ?? '') : ''
  const isAugmentation = (label: string) => Boolean(augmentation) && bare(label).includes(augmentation)
  // Le même id que celui que `collectKeyItem` lui donnera : déchiffré dans le
  // récit, il reste déchiffré une fois dans l'inventaire.
  if (scene.key_item?.name && !scene.grants_augmentation) {
    out.push({
      id: `cle_${scene.scene_id}`,
      label: scene.key_item.name,
      observation: scene.key_item.observation,
    })
  }
  if (scene.sealed_object?.name && !isAugmentation(scene.sealed_object.name)) {
    out.push({
      id: scene.sealed_object.id,
      label: scene.sealed_object.name,
      observation: scene.sealed_object.observation,
    })
  }
  for (const obj of visible(scene.interactables, revealed)) {
    if (!obj.label || !isTakeable(obj, lang) || isAugmentation(obj.label)) continue
    out.push({ id: obj.id, label: obj.label, observation: obj.observation })
  }
  return out
}

/** Celles qui ont quelque chose à apprendre : c'est ce que la loupe sert à lire. */
export function teaching(
  scene: Parameters<typeof analyzables>[0],
  lang: LangCode = DEFAULT_LANG,
  revealed: string[] = [],
): Analyzable[] {
  return analyzables(scene, lang, revealed).filter(o => o.observation?.trim())
}

/** Le nom sans casse, sans accent, sans espace ni ponctuation : « Lentille Sel-Racine » = « LentilleSelRacine ». */
function bare(input: string): string {
  return normalize(input).replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Le texte réduit à ses mots, ponctuation comprise comme une séparation. */
function words(input: string): string {
  return ` ${normalize(input).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
}

/**
 * L'objet du décor que cette saisie RÉCLAME.
 *
 * Le verbe doit y être — sans lui, décrire une chose reviendrait à l'empocher —
 * et le nom aussi, écrit en entier. C'est toute la boucle de la scène : le
 * récit brouille le nom de ce qui s'acquiert, et on ne ramasse pas ce qu'on ne
 * sait pas encore nommer. Le bouton qui s'ouvrait sous le texte dès l'arrivée
 * court-circuitait la boucle entière — il offrait l'objet d'un geste avant même
 * que le joueur ait de quoi le lire.
 *
 * Ne rend que ce que la scène montre à cet instant : un élément caché
 * qu'aucun échange n'a découvert ne se nomme pas, et la sortie ne se ramasse pas.
 */
export function takeTarget(
  input: string,
  objects: Interactable[] = [],
  lang: LangCode = DEFAULT_LANG,
  revealed: string[] = [],
): Interactable | null {
  const p = pack(lang)
  if (!matchesKeyword(input, p.input.take)) return null

  // Les plus longs d'abord : « de la » avant « de », sinon « de » gagne et
  // laisse « la » collé au nom.
  const articles = p.input.articles
    .map(a => normalize(a))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  const text = words(input)

  // Le nom le plus long d'abord : « la Trappe Secrète » ne doit pas se faire
  // coiffer par « la Trappe » au motif qu'elle est première dans le tableau.
  const candidates = visible(objects, revealed)
    .filter(o => o.label && isTakeable(o, lang))
    .sort((a, b) => b.label.length - a.label.length)

  for (const obj of candidates) {
    const label = articles.reduce(
      (name, article) => name.startsWith(article) ? name.slice(article.length).trim() : name,
      words(obj.label).trim())
    // Deux lettres se retrouvent dans n'importe quelle phrase.
    if (!significant(label, 2)) continue
    if (hasWord(text, label)) return obj
  }
  return null
}

/**
 * Ce que l'analyse d'une chose révèle, où qu'elle se trouve.
 *
 * D'abord la scène — c'est elle qui l'a écrit —, puis l'inventaire, pour tout
 * ce que le joueur traîne depuis une scène précédente et rouvre maintenant.
 * Deux moments s'en servent et ne doivent pas diverger : l'épreuve qu'on vient
 * de réussir, et le ramassage, qui emporte l'observation AVEC l'objet — la
 * scène qui l'a écrite sera loin quand le joueur pensera enfin à la rouvrir.
 */
export function observationOf(
  scene: Parameters<typeof analyzables>[0] | null | undefined,
  inventory: Array<{ id: string; observation?: string }>,
  id: string,
  lang: LangCode = DEFAULT_LANG,
  revealed: string[] = [],
): string | undefined {
  const here = scene
    ? analyzables(scene, lang, revealed).find(o => o.id === id)?.observation
    : undefined
  return here || inventory.find(o => o.id === id)?.observation
}
