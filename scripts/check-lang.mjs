/**
 * Contrôle des packs de langue, sans appeler personne.
 *
 * Une clé oubliée ne se voit qu'à l'écran, et seulement dans la langue où elle
 * manque : on ne rejoue pas douze fois la partie pour s'en apercevoir. Ce
 * script compare donc les douze packs entre eux, à froid.
 *
 * Le français fait référence — c'est la langue d'écriture du jeu, et
 * `game/script.json` en est déjà la version. Toute clé qu'il porte, les onze
 * autres doivent la porter aussi ; toute clé qu'il ne porte pas est une clé
 * qu'aucun composant ne lira jamais.
 *
 *   node scripts/check-lang.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../game/lang/', import.meta.url)
const script = JSON.parse(readFileSync(new URL('../game/script.json', import.meta.url), 'utf-8'))

const CODES = ['fr', 'en', 'es', 'pt', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'id', 'vi', 'zh', 'ja', 'ar']
const errors = []
const warn = []

const files = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
for (const code of CODES) if (!files.includes(code)) errors.push(`pack manquant : game/lang/${code}.json`)
for (const f of files) if (!CODES.includes(f)) warn.push(`game/lang/${f}.json n'est pas dans la liste des langues`)

const packs = new Map()
for (const code of CODES.filter(c => files.includes(c))) {
  packs.set(code, JSON.parse(readFileSync(new URL(`${code}.json`, dir), 'utf-8')))
}

const fr = packs.get('fr')
if (!fr) {
  console.error('game/lang/fr.json est introuvable : rien à comparer.')
  process.exit(1)
}

// --- forme d'un pack --------------------------------------------------------
const GENERATION_FIELDS = ['name_fr', 'directive', 'agreement', 'naming_form', 'caps_note', 'vocabulary', 'address']
const AGREEMENTS = ['masculin', 'feminin', 'neutre']
const INPUT_LISTS = ['exit', 'exit_strict', 'take', 'address', 'guidance', 'look', 'leave', 'search', 'world', 'articles', 'stopwords']

for (const [code, pack] of packs) {
  const at = `${code}.json`
  if (pack.code !== code) errors.push(`${at} : le champ "code" vaut "${pack.code}"`)
  if (!pack.endonym) errors.push(`${at} : "endonym" manquant — c'est ce qu'affiche le sélecteur`)
  if (!pack.tag) errors.push(`${at} : "tag" manquant — l'attribut lang du document en dépend`)
  // Une écriture sans casse qui garderait le signal par défaut n'aurait AUCUN
  // signal : la majuscule n'y existe pas, et rien ne passerait en gras.
  const cased = /[A-Za-zÀ-ÿĀ-žА-я]/.test(pack.endonym)
  if (!cased && pack.writing?.signal !== 'bold') {
    errors.push(`${at} : écriture sans casse, "writing.signal" doit valoir "bold"`)
  }

  for (const field of GENERATION_FIELDS) {
    if (!(field in (pack.generation ?? {}))) errors.push(`${at} : generation.${field} manquant`)
  }
  for (const key of AGREEMENTS) {
    if (!pack.generation?.agreement?.[key]) errors.push(`${at} : generation.agreement.${key} manquant`)
  }
  // Le français est le seul pack qui puisse laisser `vocabulary` vide : son
  // lexique imposé vit déjà dans game/script.json.
  if (code !== 'fr' && !pack.generation?.vocabulary) {
    errors.push(`${at} : generation.vocabulary est vide — le mot de la sortie ne serait imposé nulle part`)
  }

  for (const list of INPUT_LISTS) {
    const value = pack.input?.[list]
    if (!Array.isArray(value)) { errors.push(`${at} : input.${list} n'est pas une liste`); continue }
    // `articles` et `stopwords` ont le droit d'être vides : beaucoup de langues
    // n'ont pas d'article, et c'est un fait, pas un oubli.
    if (!value.length && !['articles', 'stopwords'].includes(list)) {
      errors.push(`${at} : input.${list} est vide`)
    }
    const dupes = value.filter((v, i) => value.indexOf(v) !== i)
    if (dupes.length) warn.push(`${at} : input.${list} répète ${[...new Set(dupes)].join(', ')}`)
  }
}

// --- l'habillage, clé pour clé ---------------------------------------------
const frKeys = Object.keys(fr.ui ?? {}).sort()
if (!frKeys.length) errors.push('fr.json : le bloc "ui" est vide')

/** Les variables d'une chaîne : {{name}}, {{days}}… Elles doivent survivre. */
const varsOf = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join(',')

for (const [code, pack] of packs) {
  if (code === 'fr') continue
  const keys = Object.keys(pack.ui ?? {})
  for (const key of frKeys) {
    if (!(key in (pack.ui ?? {}))) { errors.push(`${code}.json : ui.${key} manquante`); continue }
    // Une variable perdue à la traduction laisse un trou à l'écran, ou pire :
    // un « {{name}} » affiché tel quel.
    const expected = varsOf(fr.ui[key])
    const got = varsOf(pack.ui[key])
    if (expected !== got) {
      errors.push(`${code}.json : ui.${key} porte {{${got || '—'}}} au lieu de {{${expected || '—'}}}`)
    }
  }
  for (const key of keys) {
    if (!frKeys.includes(key)) warn.push(`${code}.json : ui.${key} n'existe pas en français — personne ne la lira`)
  }
}

// --- la surcharge du script -------------------------------------------------
// Le français ne surcharge rien : script.json EST sa version. Les autres
// doivent couvrir tout ce qui s'affiche, scène par scène et acte par acte.
const sceneIds = script.scenes.map(s => s.id)
const actIds = script.acts.map(a => a.id)
const withExit = script.scenes.filter(s => (s.exits ?? []).length).map(s => s.id)

if (Object.keys(fr.script ?? {}).length) {
  warn.push('fr.json : le bloc "script" devrait rester vide — game/script.json est déjà le français')
}

const FALLBACK_KEYS = Object.keys(script.defaults.error_fallbacks)

for (const [code, pack] of packs) {
  if (code === 'fr') continue
  const s = pack.script ?? {}
  const at = `${code}.json`

  for (const key of FALLBACK_KEYS) {
    if (!s.error_fallbacks?.[key]) errors.push(`${at} : script.error_fallbacks.${key} manquant`)
  }
  for (const id of sceneIds) {
    if (!s.scene_titles?.[id]) errors.push(`${at} : script.scene_titles.${id} manquant`)
  }
  for (const id of actIds) {
    if (!s.act_titles?.[id]) errors.push(`${at} : script.act_titles.${id} manquant`)
  }
  for (const id of withExit) {
    if (!s.exit_labels?.[id]) errors.push(`${at} : script.exit_labels.${id} manquant`)
  }
  for (const block of ['augmentation_primer', 'eye_primer', 'paywall', 'limits']) {
    if (!s[block]) errors.push(`${at} : script.${block} manquant`)
  }

  // Le sas est le mot que le joueur tapera : s'il n'est dans aucun mot-clé de
  // sortie, la porte ne s'ouvrira jamais dans cette langue.
  const label = s.exit_labels?.[script.progression.start_scene] ?? ''
  const words = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}]+/u).filter(w => w.length > 2)
  const keywords = (pack.input?.exit ?? []).map(k => k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
  // Sans espaces (chinois, japonais) ou à particules collées (arabe), le jeu
  // cherche les mots-clés comme sous-chaînes : il suffit qu'un d'eux tienne
  // dans le libellé.
  const dense = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}]/u.test(label)
  if (dense) {
    if (!keywords.some(k => k && label.normalize('NFD').includes(k))) {
      errors.push(`${at} : aucun mot-clé de input.exit ne figure dans « ${label} » — la sortie serait introuvable`)
    }
  } else if (words.length && !words.some(w => keywords.some(k => k.split(' ').includes(w)))) {
    errors.push(`${at} : aucun mot de « ${label} » n'est dans input.exit — la sortie serait introuvable`)
  }
}

// --- verdict ----------------------------------------------------------------
for (const w of warn) console.warn('  ! ' + w)
if (errors.length) {
  console.error(`${errors.length} problème(s) dans les packs de langue :`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log(
  `Packs cohérents : ${packs.size} langues, ${frKeys.length} chaînes d'habillage chacune, `
  + `${sceneIds.length} titres de scène et ${actIds.length} titres d'acte surchargés.`)
