/**
 * Contrôle structurel du script, sans appeler personne.
 *
 * Une scène mal formée ne se voit qu'à la génération, et une génération se
 * paie. Ce script vérifie donc à froid tout ce qui peut l'être : identifiants,
 * ordre, blocs obligatoires, cohérence des renvois entre `naming` et `decor`.
 *
 *   node scripts/check-script.mjs
 */
import { readFileSync } from 'node:fs'

const script = JSON.parse(readFileSync(new URL('../game/script.json', import.meta.url), 'utf-8'))
const errors = []
const warn = []

const byId = new Map(script.scenes.map(s => [s.id, s]))
const order = script.progression.order

// --- progression ------------------------------------------------------------
if (!byId.has(script.progression.start_scene)) {
  errors.push(`progression.start_scene "${script.progression.start_scene}" n'existe pas`)
}
for (const id of order) if (!byId.has(id)) errors.push(`progression.order cite "${id}", absente de scenes`)
for (const s of script.scenes) if (!order.includes(s.id)) errors.push(`la scène "${s.id}" n'est pas dans progression.order`)
order.forEach((id, i) => {
  const s = byId.get(id)
  if (s && s.order !== i + 1) errors.push(`"${id}" : order=${s.order} mais rang ${i + 1} dans progression`)
})

// --- actes ------------------------------------------------------------------
const inActs = script.acts.flatMap(a => a.scenes)
for (const id of inActs) if (!byId.has(id)) errors.push(`l'acte cite "${id}", absente de scenes`)
for (const s of script.scenes) {
  if (s.id === script.progression.start_scene) continue
  if (!inActs.includes(s.id)) errors.push(`"${s.id}" n'appartient à aucun acte`)
  const act = script.acts.find(a => a.scenes.includes(s.id))
  if (act && s.act !== act.id) errors.push(`"${s.id}" : act="${s.act}" mais listée dans l'acte "${act.id}"`)
}

// --- chaque scène -----------------------------------------------------------
const ACQUISITIONS = ['informant_then_holder', 'holder', 'found']
for (const s of script.scenes) {
  // L'épilogue ne suit pas le schéma des autres : ni personnages, ni quête, ni
  // objet-clé. Il rend un texte et une image, et rien d'autre.
  if (s.kind === 'ending') {
    for (const k of ['image_setting', 'focal_element', 'decor_slots', 'generation']) {
      if (!s[k]) errors.push(`"${s.id}" (épilogue) : bloc "${k}" manquant`)
    }
    const out = s.generation?.output_schema ?? {}
    for (const k of ['ending_html', 'palette', 'decor']) {
      if (!out[k]) errors.push(`"${s.id}" (épilogue) : le schéma de sortie ne demande pas "${k}"`)
    }
    if (!s.generation?.instruction?.includes('<h2>')) {
      errors.push(`"${s.id}" (épilogue) : l'instruction ne fixe pas les balises autorisées`)
    }
    // La fin doit viser la résolution déclarée, sinon elle n'est plus la fin
    // de CETTE histoire mais une conclusion interchangeable.
    // La lecture finale est ce que le joueur emporte : elle doit être demandée,
    // et ses registres tenus par le script plutôt que laissés au modèle.
    if (!s.generation?.instruction?.includes('{{counsel}}')) {
      errors.push(`"${s.id}" (épilogue) : l'instruction n'interpole pas {{counsel}}`)
    }
    if (!s.counsel?.registers?.length) {
      errors.push(`"${s.id}" (épilogue) : aucun registre pour la lecture finale`)
    }
    if (!s.counsel?.instruction?.includes('{{registers}}')) {
      errors.push(`"${s.id}" (épilogue) : counsel n'interpole pas {{registers}}`)
    }
    for (const token of ['{{tension}}', '{{resolution}}', '{{acts}}']) {
      if (!s.theme_frame?.instruction?.includes(token)) {
        errors.push(`"${s.id}" (épilogue) : theme_frame n'interpole pas ${token}`)
      }
    }
    continue
  }

  const need = ['title', 'image_setting', 'focal_element', 'naming', 'decor_slots',
                'npcs', 'quest', 'interactables', 'exits', 'key_item', 'objective']
  for (const k of need) if (!s[k]) errors.push(`"${s.id}" : bloc "${k}" manquant`)
  if (!s.decor_slots?.length) errors.push(`"${s.id}" : aucun élément de décor`)
  if (!s.exits?.[0]?.label) errors.push(`"${s.id}" : aucune sortie nommée`)
  if (!s.npcs?.count) errors.push(`"${s.id}" : npcs.count manquant`)

  const acq = s.key_item?.acquisition
  if (acq && !ACQUISITIONS.includes(acq)) errors.push(`"${s.id}" : acquisition "${acq}" inconnue`)
  // Trois rôles distincts exigent au moins trois personnages.
  if (acq === 'informant_then_holder' && s.npcs?.count < 3) {
    errors.push(`"${s.id}" : ${s.npcs.count} PNJ pour un motif qui en demande 3 (accueil, informateur, détenteur)`)
  }

  // `naming.must_reference` pointe vers un slot : il doit exister.
  for (const ref of s.naming?.must_reference ?? []) {
    if (!ref.startsWith('decor.')) continue
    const slot = ref.slice('decor.'.length)
    if (!s.decor_slots.some(d => d.id === slot)) {
      errors.push(`"${s.id}" : naming renvoie au décor "${slot}", qui n'existe pas`)
    }
  }
  // Un seul slot d'accent : c'est lui qui porte la couleur du lieu.
  const accents = s.decor_slots?.filter(d => d.visual_weight === 'accent') ?? []
  if (accents.length !== 1) warn.push(`"${s.id}" : ${accents.length} éléments d'accent (1 attendu)`)
}

// --- ce que la salle apprend -------------------------------------------------
// Les morceaux se recollent : il en manque un dès qu'un personnage n'en porte
// pas, et le joueur perd la seule occasion du jeu d'apprendre ce qui l'attend.
const ACT_IDS = script.acts.map(a => a.id)
for (const s of script.scenes) {
  const k = s.npcs?.knowledge
  if (!k) continue
  if (!k.instruction) errors.push(`"${s.id}" : npcs.knowledge sans instruction`)
  const frags = k.fragments ?? []
  if (frags.length !== s.npcs.count) {
    errors.push(`"${s.id}" : ${frags.length} morceaux de savoir pour ${s.npcs.count} personnages`)
  }
  frags.forEach((f, i) => {
    if (!f.npc || !f.holds || !f.told_as) {
      errors.push(`"${s.id}" : morceau ${i + 1} incomplet (npc, holds, told_as)`)
    }
    // Un morceau qui vise un acte inexistant promet un endroit où le joueur
    // n'ira jamais.
    if (f.act && f.act !== s.act && !ACT_IDS.includes(f.act)) {
      errors.push(`"${s.id}" : le morceau ${i + 1} vise l'acte "${f.act}", qui n'existe pas`)
    }
  })

  // Un morceau qu'aucun prompt ne transmet reste dans le script.
  const gen = s.generation ?? script.defaults.generation
  if (!gen.output_schema?.npcs?.[0]?.beyond) {
    errors.push(`"${s.id}" : le schéma de sortie ne demande pas "beyond" aux personnages`)
  }
  const turn = { ...script.defaults.turn, ...(s.turn ?? {}) }
  if (!turn.beyond_rule?.includes('{{npc_beyond}}')) {
    errors.push(`"${s.id}" : turn.beyond_rule manquante ou sans {{npc_beyond}}`)
  }
  const carriers = Object.entries(turn)
    .filter(([k, v]) => k.endsWith('_prompt') && typeof v === 'string' && v.includes('{{beyond_rule}}'))
  if (!carriers.length) {
    errors.push(`"${s.id}" : aucun prompt de réplique n'interpole {{beyond_rule}}`)
  }
}

// --- positions face à la tension --------------------------------------------
const POSTURES = Object.keys(script.onomastics.posture)
for (const s of script.scenes) {
  const stances = s.cast_stances
  if (!stances || s.kind === 'ending') continue

  if (stances.length !== s.npcs.count) {
    errors.push(`"${s.id}" : ${stances.length} positions pour ${s.npcs.count} personnages`)
  }
  for (const st of stances) {
    if (!POSTURES.includes(st.posture)) errors.push(`"${s.id}" : posture "${st.posture}" absente du syllabaire`)
    if (st.means !== script.onomastics.posture[st.posture]) {
      errors.push(`"${s.id}" : le sens de "${st.posture}" ne correspond plus au syllabaire`)
    }
  }

  const list = stances.map(x => x.posture)
  const { holder_stance: holder, informant_stance: informant, acquisition } = s.key_item
  if (holder && !list.includes(holder)) errors.push(`"${s.id}" : détenteur "${holder}" hors distribution`)
  if (informant && !list.includes(informant)) errors.push(`"${s.id}" : informateur "${informant}" hors distribution`)

  if (acquisition === 'informant_then_holder') {
    if (!holder || !informant) errors.push(`"${s.id}" : motif à trois rôles sans détenteur ou sans informateur désigné`)
    if (holder && holder === informant) errors.push(`"${s.id}" : détenteur et informateur sur la même position`)
    // Celui qui accueille expose, il ne résout rien : la validation serveur le refuse.
    if (holder === list[0] || informant === list[0]) {
      errors.push(`"${s.id}" : celui qui accueille (${list[0]}) ne peut être ni détenteur ni informateur`)
    }
  }
  if (acquisition === 'found' && holder) errors.push(`"${s.id}" : objet à trouver, mais un détenteur est désigné`)
  if (acquisition === 'holder' && !holder) errors.push(`"${s.id}" : motif à détenteur sans détenteur désigné`)

  // Une facette doit exister et désigner un vrai nombre.
  const facet = s.theme_focus?.facet
  if (!facet) errors.push(`"${s.id}" : theme_focus manquant`)
  else if (!['drive', 'destiny', 'reception'].includes(facet)) {
    errors.push(`"${s.id}" : facette "${facet}" inconnue`)
  }
  if (s.objective && !s.objective.requirement && !s.objective.statement) {
    errors.push(`"${s.id}" : objectif sans exigence`)
  }
}
if (!script.defaults.objective_derivation?.instruction?.includes('{{requirement}}')) {
  errors.push('objective_derivation n\'interpole pas {{requirement}}')
}

// --- l'augmentation, objet de la scène d'ouverture ---------------------------
// C'est le SEUL objet à récupérer scène 1 : elle rend lisibles les noms des
// choses qu'on croisera dans les scènes suivantes. `quest.artifact`, lui, reste
// l'horizon derrière le sas et ne descend jamais dans le bar.
const opening = byId.get(script.progression.start_scene)
if (opening?.objective?.kind !== 'acquire_augmentation') {
  errors.push(`"${script.progression.start_scene}" : l'objectif d'ouverture n'est pas d'acquérir l'augmentation`)
}
// Son nom propre est prononcé dans le texte et brouillé : sans la règle, le
// modèle rend « La Lentille de Sel », que le brouillage découpe en trois blocs.
for (const marker of ['SON NOM PROPRE', 'key_item.observation']) {
  if (!opening?.key_item?.instruction?.includes(marker)) {
    errors.push(`"${script.progression.start_scene}" : key_item.instruction ne pose pas "${marker}"`)
  }
}
// Le porteur et l'informateur se choisissent sur le thème du joueur, pas au
// hasard : sans ça la remise n'a aucune raison d'arriver à ce joueur-là.
for (const source of ['NOMBRES', 'SIGNE']) {
  if (!opening?.key_item?.instruction?.includes(source)) {
    errors.push(`"${script.progression.start_scene}" : key_item.instruction ne dérive rien de la section ${source}`)
  }
}
// Le texte d'ouverture doit le nommer et raconter d'où il vient, sinon il n'y a
// rien à brouiller et le joueur ne voit jamais ce qui lui manque.
if (!opening?.narrative?.structure?.some(x => x.includes('key_item.name'))) {
  errors.push(`"${script.progression.start_scene}" : la structure du texte ne fait pas nommer l'augmentation`)
}
if (!script.defaults.generation?.output_schema?.key_item?.observation) {
  errors.push('le schéma de sortie ne demande pas "key_item.observation"')
}

// --- la quête de la nuit -----------------------------------------------------
// La racine de la partie. Le script ne fixe que le décor ; le dossier fixe un
// but et un plan, écrits en premier à l'auberge, et chaque scène se construit
// sur son étape. L'ouverture doit énoncer le but AVANT que le barman parle :
// sans ça, la seule scène gratuite expose l'objet à récupérer dans la salle.
const night = script.defaults.night
for (const f of ['instruction', 'plan', 'fixed', 'derives']) {
  if (!night?.[f]) errors.push(`defaults.night : champ "${f}" manquant`)
}
for (const v of ['{{goal}}', '{{plan}}', '{{place}}', '{{focal}}', '{{requirement}}', '{{exit_label}}']) {
  if (night?.fixed && !night.fixed.includes(v)) errors.push(`defaults.night.fixed n'interpole pas ${v}`)
}
// Le but se calcule sur le signe et les nombres. Laissé libre dans le dossier,
// le modèle prenait la personne qui compte, et la nuit devenait celle d'un autre.
if (!night?.calculus?.instruction?.includes('{{lines}}')) {
  errors.push('defaults.night.calculus n\'interpole pas {{lines}} : le but ne serait plus calculé')
}
if (!night?.calculus?.fallback) errors.push('defaults.night.calculus.fallback manquant')
for (const [key, sign] of Object.entries(script.zodiac.signs)) {
  if (!sign.adventure) errors.push(`le signe "${key}" n'a pas d'aventure : night.goal n'aurait rien à calculer`)
}
if (/pour qui|personne qui compte pour lui :/i.test(night?.instruction ?? '')) {
  errors.push('defaults.night.instruction renvoie encore le but vers une personne du dossier')
}
if (night?.plan && !night.plan.includes('{{slots}}')) {
  errors.push('defaults.night.plan n\'interpole pas {{slots}} : le modèle ne verrait pas la mécanique imposée')
}
const outSchema = script.defaults.generation?.output_schema ?? {}
if (Object.keys(outSchema)[0] !== 'night') {
  errors.push('le schéma de sortie ne commence pas par "night" : la quête doit être écrite avant ce qui en découle')
}
for (const f of ['goal', 'tension', 'release', 'acts']) {
  if (!outSchema.night?.[f]) errors.push(`le schéma de sortie ne demande pas "night.${f}"`)
}
for (const f of ['scene_id', 'title', 'place', 'focal', 'step', 'requirement', 'exit_label']) {
  if (!outSchema.night?.acts?.[0]?.scenes?.[0]?.[f]) errors.push(`le schéma de sortie ne demande pas "night.acts[].scenes[].${f}"`)
}
// Le décor ne se fixe plus dans le script : un lieu d'acte ne déclare que sa
// mécanique, et c'est elle que le plan lit pour inventer le lieu.
for (const act of script.acts) {
  for (const id of act.scenes) {
    const s = byId.get(id)
    if (s && s.kind !== 'ending' && !s.mechanic) {
      errors.push(`"${id}" : mécanique manquante — le plan ne saurait pas ce qu'on obtient dans ce lieu`)
    }
  }
}
// La tension se montre au paiement : sans ses variables, le point reste vide.
const pitchText = JSON.stringify(script.paywall?.pitch ?? {})
for (const v of ['{{tension}}', '{{release}}']) {
  if (!pitchText.includes(v)) errors.push(`paywall.pitch n'affiche pas ${v}`)
}
if (JSON.stringify(script).includes('night_goal') && !JSON.stringify(script).includes('{{quest_night_goal}}')) {
  errors.push('"night_goal" traîne encore dans le script : il a été remplacé par night.goal')
}
if (script.defaults.quest?.structure?.errand || outSchema.quest?.errand) {
  errors.push('"errand" est encore demandé : il a été remplacé par night.goal')
}
// À l'auberge, l'intro ne parle que de la fête : seul le barman dit le but.
if (opening?.narrative?.opening?.includes('night.goal')) {
  errors.push(`"${script.progression.start_scene}" : l'ouverture renvoie à night.goal`)
}
if (!script.defaults.turn?.system_prompt_template?.includes('{{quest_night_goal}}')) {
  errors.push('defaults.turn.system_prompt_template ne donne pas le but de la nuit aux tours')
}

// --- la fenêtre d'explication ------------------------------------------------
// Elle s'ouvre au premier passage à la loupe et n'est jamais régénérée : chaque
// jeton de son récit doit venir d'un champ déjà produit, et avoir un repli.
const primer = script.defaults.augmentation_primer
if (!primer) {
  errors.push('defaults.augmentation_primer manquant')
} else {
  for (const f of ['eyebrow', 'story', 'story_fallbacks', 'howto_title', 'howto_pointer', 'howto_gyro', 'footer', 'cta']) {
    if (!primer[f]) errors.push(`defaults.augmentation_primer : champ "${f}" manquant`)
  }
  const tokens = new Set((primer.story ?? []).flatMap(l => [...l.matchAll(/{{(\w+)}}/g)].map(m => m[1])))
  for (const t of tokens) {
    // `item_name` vient toujours de la fiche : il ne peut pas être vide.
    if (t !== 'item_name' && !(t in (primer.story_fallbacks ?? {}))) {
      warn.push(`defaults.augmentation_primer : {{${t}}} n'a pas de repli`)
    }
  }
}

// --- échange d'objets --------------------------------------------------------
// L'inventaire a deux raisons d'être : relire ce qu'on porte, et le donner. La
// seconde ne tient qu'à cette chaîne — une règle, un champ dans le schéma, deux
// prompts et l'accroche qui la greffe aux répliques.
const exchange = script.defaults.exchange
if (!exchange?.instruction) errors.push('defaults.exchange manquant : rien ne dit ce qu\'un PNJ peut réclamer')
const npcSchema = script.defaults.generation?.output_schema?.npcs?.[0]
for (const f of ['item_id', 'hint', 'reward']) {
  if (!npcSchema?.wants?.[f]) errors.push(`le schéma de sortie ne demande pas "npcs[].wants.${f}"`)
}
for (const f of ['wants_rule', 'give_prompt', 'give_refused_prompt']) {
  if (!script.defaults.turn?.[f]) errors.push(`defaults.turn.${f} manquant`)
}
if (!script.defaults.turn?.wants_rule?.includes('{{npc_wants_hint}}')) {
  errors.push('turn.wants_rule n\'interpole pas {{npc_wants_hint}}')
}
if (!script.defaults.turn?.give_prompt?.includes('{{item_reward}}')) {
  errors.push('turn.give_prompt n\'interpole pas {{item_reward}} : l\'échange ne rendrait rien')
}
// Sans accroche, la règle reste dans le script et le personnage ne demande rien.
const wantsCarriers = Object.entries(script.defaults.turn ?? {})
  .filter(([k, v]) => k.endsWith('_prompt') && typeof v === 'string' && v.includes('{{wants_rule}}'))
if (!wantsCarriers.length) {
  errors.push('aucun prompt de réplique n\'interpole {{wants_rule}}')
}

// --- conversation -----------------------------------------------------------
// Une réplique de personnage n'a que deux façons de tomber à côté : ignorer ce
// que le joueur vient de dire, ou oublier ce qu'il a dit avant. Deux règles les
// couvrent, et elles ne servent à rien si un prompt les oublie.
const CONVERSATION_RULES = ['reply_rule', 'thread_rule']
for (const rule of CONVERSATION_RULES) {
  if (!script.defaults.turn?.[rule]) {
    errors.push(`defaults.turn.${rule} manquant : les personnages répondraient à côté`)
    continue
  }
  const carried = Object.entries(script.defaults.turn)
    .filter(([k, v]) => k.endsWith('_prompt') && typeof v === 'string'
      && v.includes(`{{${rule}}}`))
  if (!carried.length) errors.push(`aucun prompt de réplique n'interpole {{${rule}}}`)
}
// Les deux vont ensemble : un prompt qui demande de répondre sans donner accès
// au fil fait redire la même chose à chaque tour.
const replyOnly = Object.entries(script.defaults.turn ?? {})
  .filter(([k, v]) => k.endsWith('_prompt') && typeof v === 'string'
    && v.includes('{{reply_rule}}') && !v.includes('{{thread_rule}}')
    // Le don et le refus sont des réactions d'un seul temps : rien à continuer.
    && !k.startsWith('give'))
for (const [k] of replyOnly) {
  warn.push(`turn.${k} interpole {{reply_rule}} sans {{thread_rule}} : ce personnage répondra sans mémoire`)
}

// --- continuité -------------------------------------------------------------
const c = script.defaults.continuity
if (!c?.prompt?.includes('{{journal}}')) errors.push('continuity.prompt n\'interpole pas {{journal}}')
if (!c?.empty) errors.push('continuity.empty manquant')

// --- unicité des noms de lieux ----------------------------------------------
const titles = script.scenes.map(s => s.title)
for (const t of new Set(titles)) {
  if (titles.filter(x => x === t).length > 1) errors.push(`titre en double : "${t}"`)
}

for (const w of warn) console.warn('  ! ' + w)
if (errors.length) {
  console.error(`${errors.length} problème(s) dans le script :`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log(`Script cohérent : ${script.scenes.length} scènes, ${script.acts.length} actes, `
  + `${order.length} étapes de progression.`)
