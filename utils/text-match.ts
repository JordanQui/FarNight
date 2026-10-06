/**
 * Comparaison de commandes joueur. Partagé client/serveur : aucune dépendance
 * Node, pour rester importable dans les composables.
 */

/**
 * Minuscules, sans accents, apostrophes normalisées.
 *
 * NFKD et non NFD : le japonais se tape souvent en pleine chasse (« ＯＫ ») ou
 * en katakana demi-chasse, et le modèle n'écrit ni l'un ni l'autre. L'arabe
 * perd ses voyelles brèves, son tatweel et les variantes de l'alif — un joueur
 * ne les tape presque jamais, le modèle les met quand il veut.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/['\u2019]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Écritures où un mot ne se borne pas par des espaces.
 *
 * Le chinois et le japonais n'en mettent pas du tout ; l'arabe colle ses
 * prépositions et sa conjonction au mot suivant (« والمفتاح », « بالمفتاح »).
 * Chercher « ` mot ` » n'y trouverait jamais rien : on y cherche la sous-chaîne.
 */
const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}]/u

export function isDense(word: string): boolean {
  return DENSE.test(word)
}

/**
 * Le mot est-il assez long pour être cherché sans risque ?
 *
 * Les seuils en lettres latines — « plus de trois » — éliminaient tout nom
 * chinois : deux idéogrammes disent autant qu'un mot de six lettres.
 */
export function significant(word: string, min: number): boolean {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) return [...word].length >= 2
  return word.length > min
}

/**
 * `word` figure-t-il dans `text` comme mot entier ?
 *
 * `text` est déjà normalisé et entouré d'espaces. Dans une écriture dense, la
 * borne n'existe pas : la sous-chaîne suffit.
 */
export function hasWord(text: string, word: string): boolean {
  if (!word) return false
  if (isDense(word)) return text.includes(word)
  return text.includes(` ${word} `)
}

/**
 * Vrai si l'un des mots-clés apparaît comme mot entier.
 * `includes` brut faisait matcher « pars » dans « parsemé » et ratait
 * « Sortir ! » à cause de la ponctuation.
 */
export function matchesKeyword(input: string, keywords: string[]): boolean {
  const haystack = ` ${normalize(input)} `
  return keywords.some((keyword) => {
    const needle = normalize(keyword)
    if (!needle) return false
    if (isDense(needle)) return haystack.includes(needle)
    return haystack.includes(` ${needle} `)
      || haystack.includes(` ${needle},`)
      || haystack.includes(` ${needle}.`)
      || haystack.includes(` ${needle}!`)
      || haystack.includes(` ${needle}?`)
  })
}

/**
 * La saisie est-elle une question ?
 *
 * Le point d'interrogation suffit, dans toutes ses graphies — l'espagnol
 * l'ouvre, l'arabe le retourne, et la pleine chasse japonaise est déjà ramenée
 * à « ? » par `normalize`. Sans lui, un mot interrogatif du pack de langue :
 * sur un téléphone, « pourquoi tu restes là » se tape sans ponctuation, et
 * c'est bien une question. Le trait d'union tombe avant : « sais-tu » doit
 * se lire comme « sais tu ».
 */
export function isQuestion(input: string, words: string[]): boolean {
  if (/[?¿؟？]/.test(input)) return true
  return matchesKeyword(input.replace(/[-‐]/g, ' '), words)
}

/**
 * La saisie n'est-elle qu'une salutation — « bonjour », « bonsoir Kaneshi ! » ?
 *
 * Une fois retirés les mots de salut, le nom du personnage et la ponctuation,
 * il ne doit rien rester. « Bonjour, je cherche le module » n'en est pas une :
 * la phrase dit autre chose, la règle des questions s'y applique.
 */
export function isGreeting(input: string, words: string[], name = ''): boolean {
  let text = ` ${normalize(input).replace(/[^\p{L}\p{N} ]/gu, ' ')} `
  let greeted = false
  for (const word of words.map(normalize).filter(Boolean).sort((a, b) => b.length - a.length)) {
    const needle = isDense(word) ? word : ` ${word} `
    if (!text.includes(needle)) continue
    greeted = true
    text = text.split(needle).join(' ')
  }
  if (!greeted) return false
  for (const part of normalize(name).split(' ').filter(Boolean)) text = text.split(part).join(' ')
  return !text.replace(/[^\p{L}\p{N}]+/gu, '')
}
