/**
 * Le registre des langues.
 *
 * Les packs sont IMPORTÉS, pas lus sur le disque : en serverless (Vercel) le
 * process ne voit que le bundle, jamais l'arborescence du repo. C'est le même
 * parti que `game/script.json` dans `utils/script-runtime.ts`, et pour la même
 * raison — l'import les inline dans le build, donc ils sont toujours là.
 *
 * Quinze fichiers de quelques dizaines de kilo-octets : le poids est réel mais
 * borné, et le charger à la demande ne servirait à rien côté serveur, où un
 * appel peut tomber sur n'importe quelle lambda et devrait donc tout embarquer
 * de toute façon.
 */

import frPack from '../game/lang/fr.json'
import enPack from '../game/lang/en.json'
import esPack from '../game/lang/es.json'
import ptPack from '../game/lang/pt.json'
import dePack from '../game/lang/de.json'
import itPack from '../game/lang/it.json'
import nlPack from '../game/lang/nl.json'
import plPack from '../game/lang/pl.json'
import ruPack from '../game/lang/ru.json'
import trPack from '../game/lang/tr.json'
import idPack from '../game/lang/id.json'
import viPack from '../game/lang/vi.json'
import zhPack from '../game/lang/zh.json'
import jaPack from '../game/lang/ja.json'
import arPack from '../game/lang/ar.json'

import type { LangCode, LanguagePack, LangScript } from '~/types/i18n'
import { DEFAULT_LANG, LANG_CODES, isLangCode } from '~/types/i18n'
import type { UserAgreement } from '~/types/user'

const PACKS = {
  fr: frPack, en: enPack, es: esPack, pt: ptPack, de: dePack, it: itPack,
  nl: nlPack, pl: plPack, ru: ruPack, tr: trPack, id: idPack, vi: viPack,
  zh: zhPack, ja: jaPack, ar: arPack,
} as unknown as Record<LangCode, LanguagePack>

/** Le pack d'une langue. Toujours défini : un code inconnu retombe sur le français. */
export function pack(code: LangCode | null | undefined): LanguagePack {
  return PACKS[code ?? DEFAULT_LANG] ?? PACKS[DEFAULT_LANG]
}

/**
 * Comment cette langue signale ce qui se touche : la majuscule, ou le gras
 * quand l'écriture n'a pas de casse.
 */
export function signalOf(code: LangCode | null | undefined): 'caps' | 'bold' {
  return pack(code).writing?.signal ?? 'caps'
}

/** Le sens d'écriture, pour l'attribut `dir` du document. */
export function dirOf(code: LangCode | null | undefined): 'ltr' | 'rtl' {
  return pack(code).writing?.dir ?? 'ltr'
}

/** Ce que le sélecteur affiche, dans l'ordre du script. */
export const LANGUAGES: Array<{ code: LangCode; endonym: string }> =
  LANG_CODES.map(code => ({ code, endonym: PACKS[code].endonym }))

/**
 * Ramène ce qu'on lui donne à une langue jouable.
 *
 * Accepte les formes régionales — « en-US », « pt-BR », « zh-Hans » — parce que
 * c'est SOUS CETTE FORME que le navigateur et l'en-tête `Accept-Language` les
 * annoncent. Ne garder que le code exact aurait fait retomber tout le monde sur
 * le français, y compris les anglophones.
 */
export function resolveLang(value: unknown): LangCode {
  if (typeof value !== 'string') return DEFAULT_LANG
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  return isLangCode(base) ? base : DEFAULT_LANG
}

/**
 * La langue à proposer d'emblée, lue dans les préférences déclarées.
 *
 * Prend la PREMIÈRE langue jouable de la liste, pas la première tout court :
 * quelqu'un qui a « ko, en, fr » demande du coréen, qu'on ne sait pas jouer,
 * mais l'anglais lui ira mieux que le français. La qualité `;q=` est ignorée —
 * l'ordre d'apparition dit déjà la préférence dans tous les navigateurs.
 *
 * Sert au navigateur (`navigator.languages`) comme au serveur (`Accept-Language`).
 */
export function detectLang(declared: readonly string[] | string | null | undefined): LangCode {
  const list = typeof declared === 'string'
    ? declared.split(',').map(part => part.split(';')[0]!.trim())
    : declared ?? []

  for (const entry of list) {
    const base = entry.trim().toLowerCase().split(/[-_]/)[0]
    if (isLangCode(base)) return base
  }
  return DEFAULT_LANG
}

/** Remplace les {{variables}} d'une chaîne. Une variable inconnue disparaît. */
function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/**
 * Une chaîne d'habillage.
 *
 * Le français sert de repli, et `scripts/check-lang.mjs` fait en sorte qu'on
 * n'en ait jamais besoin : il refuse un pack auquel manque une clé française.
 * Le repli n'existe donc que pour la fenêtre entre l'ajout d'une clé et sa
 * traduction — mieux vaut une ligne en français qu'une clé nue à l'écran.
 */
export function translate(
  code: LangCode | null | undefined,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const target = pack(code).ui[key]
  if (target !== undefined) return fill(target, vars)

  const fallback = PACKS[DEFAULT_LANG].ui[key]
  if (fallback === undefined) {
    // Une clé qui n'existe nulle part est une faute de frappe, pas une
    // traduction manquante : on la rend visible plutôt que de rendre du vide.
    console.warn(`[i18n] clé inconnue : ${key}`)
    return key
  }
  return fill(fallback, vars)
}

/**
 * L'accord grammatical dit au modèle, dans les termes de la langue jouée.
 *
 * Remplace l'ancien `utils/agreement.ts`, qui ne connaissait que le français et
 * ne pouvait rien dire d'utile ailleurs : en turc ou en indonésien il n'y a pas
 * de participe à accorder, et la ligne y porte sur la façon d'interpeller le
 * joueur — c'est le seul endroit où le genre se voie encore.
 */
export function agreementFor(
  code: LangCode | null | undefined,
  agreement: UserAgreement | null | undefined,
): string | null {
  if (!agreement) return null
  return pack(code).generation.agreement[agreement] ?? null
}

/**
 * La surcharge d'affichage du script pour cette langue.
 *
 * Vide en français : `game/script.json` en est déjà la version, et le
 * dupliquer créerait deux vérités qui divergeraient au premier ajustement.
 */
export function scriptOverlay(code: LangCode | null | undefined): LangScript {
  return pack(code).script ?? {}
}

/**
 * Va chercher une valeur dans la surcharge, par chemin pointé.
 *
 * `overlayValue('en', 'paywall.pitch.eyebrow')` — et `undefined` dès qu'un
 * maillon manque, ce qui laisse l'appelant retomber sur le script français
 * sans avoir à tester trois niveaux lui-même.
 */
export function overlayValue<T = unknown>(
  code: LangCode | null | undefined,
  path: string,
): T | undefined {
  let node: unknown = scriptOverlay(code)
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node as T | undefined
}
