import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { pack, signalOf } from '~/utils/languages'
import { isDense } from '~/utils/text-match'

/**
 * La Majuscule de Titre, rendue vraie.
 *
 * C'est le SEUL signal d'interaction du jeu : ce qui porte une majuscule se
 * touche, le reste est du décor. La règle est écrite en toutes lettres dans
 * `narrative.naming_style`, avec son exemple d'échec — et le modèle l'ignore
 * quand même. Il capitalise correctement la liste `interactables` puis écrit
 * « un tourniquet de contrôle » trois phrases plus haut : le joueur voit passer
 * l'objet sans savoir qu'il peut le manipuler.
 *
 * On ne le lui redemande donc plus. Les noms sont déjà déclarés dans la scène
 * générée : il suffit de les faire respecter dans le texte. Déterministe,
 * exécuté une fois à l'assemblage, et sans un token de plus — c'est le même
 * parti que la correction d'accent de `enforceAccentVisibility`.
 */

/**
 * En dessous, un nom est trop court pour être reconnu sans risque.
 * Trois lettres laissent passer « Sas », qui est une vraie sortie.
 */
const MIN_LENGTH = 3

/**
 * L'article que traîne un nom déclaré. On le laisse en minuscules dans le texte.
 *
 * Il dépend de la langue : « le Tourniquet » se cherche par « Tourniquet »,
 * « the Turnstile » par « Turnstile », et le russe ou le polonais n'ont rien à
 * retirer du tout. Le motif est donc bâti à partir du pack, et mis en cache par
 * langue — le compiler à chaque nom d'une scène n'apporterait rien.
 */
const ARTICLE_RE = new Map<string, RegExp>()

function leadingArticle(lang: LangCode): RegExp {
  const cached = ARTICLE_RE.get(lang)
  if (cached) return cached

  const articles = pack(lang).input.articles
  // Aucun article dans cette langue : un motif qui ne matche jamais, plutôt
  // qu'un `(?:)` vide qui matcherait la chaîne nulle partout.
  const re = articles.length
    ? new RegExp(
        // Les articles élidés — « l' », « d' » — collent au mot suivant ;
        // les autres exigent une espace, sinon « le » mangerait « lecteur ».
        `^(?:${articles.map((a) => {
          const body = escapeRe(a).replace(/'/g, "['’]")
          return a.endsWith("'") ? `${body}\\s*` : `${body}\\s+`
        }).join('|')})`,
        'i')
    : /(?!)/
  ARTICLE_RE.set(lang, re)
  return re
}

/** Voyelles et leurs variantes : le modèle accentue de façon inconstante. */
const ACCENTED: Record<string, string> = {
  a: 'aàáâäã', c: 'cç', e: 'eéèêë', i: 'iíìîï',
  n: 'nñ', o: 'oóòôöõ', u: 'uúùûü', y: 'yÿ',
}

/**
 * Le texte sans accents ni casse.
 *
 * Sert à comparer ce que le modèle a écrit à ce qu'il a déclaré : il accentue
 * de façon inconstante d'une phrase à l'autre.
 */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Le caractère dépouillé de son accent. */
function base(ch: string): string {
  return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Le nom sans son article : « le Tourniquet » se cherche par « Tourniquet ». */
function stripArticle(name: string, lang: LangCode): string {
  return name.trim().replace(leadingArticle(lang), '').trim()
}

/**
 * Le motif qui retrouve un nom quelle que soit sa casse et son accentuation.
 *
 * Les espaces sont souples — le modèle en met parfois deux — et les bornes sont
 * des lettres, pas `\b` : celui-ci raisonne en ASCII et coupe « Contrôle » au
 * milieu.
 */
function pattern(name: string): RegExp {
  const body = name
    .split(/\s+/)
    .map(word => [...word].map((ch) => {
      if (ch === "'" || ch === '’') return "['’]"
      const set = ACCENTED[base(ch).toLowerCase()]
      return set ? `[${set}]` : escapeRe(ch)
    }).join(''))
    .join('\\s+')

  // Le chinois et le japonais n'ont pas d'espace, l'arabe colle ses
  // particules : une borne de lettre n'y trouverait jamais le nom.
  if (isDense(name)) return new RegExp(body, 'gu')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
}

export interface NamingAudit {
  /** Le texte, noms recapitalisés. */
  text: string
  /** Les corrections effectuées, sous la forme « trouvé -> imposé ». */
  fixed: string[]
  /** Noms déclarés que le texte ne prononce jamais : le joueur ne les verra pas. */
  missing: string[]
}

/**
 * Impose à `text` la casse canonique de chaque nom déclaré.
 *
 * Les noms les plus longs passent d'abord : sans ça « Carte d'Accès » corrigée
 * la première laisserait « Ambre » en minuscules dans « Carte d'Accès Ambre ».
 */
export function enforceNameCaps(
  text: string,
  names: string[],
  lang: LangCode = DEFAULT_LANG,
): NamingAudit {
  const fixed: string[] = []
  const missing: string[] = []
  // Sans casse, rien à recaler : seul l'audit des absents a un sens. Le gras
  // qui tient lieu de majuscule est posé à l'affichage (`NarrativeText`).
  const recase = signalOf(lang) === 'caps'

  const canonical = [...new Set(names.map(n => stripArticle(n, lang)))]
    .filter(n => n.length >= MIN_LENGTH || (isDense(n) && [...n].length >= 2))
    .sort((a, b) => b.length - a.length)

  let out = text
  for (const name of canonical) {
    let seen = false
    out = out.replace(pattern(name), (match) => {
      seen = true
      if (!recase) return match
      if (match !== name) fixed.push(`${match} -> ${name}`)
      return name
    })
    if (!seen) missing.push(name)
  }

  return { text: out, fixed, missing }
}
