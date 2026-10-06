import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { draw, type Qualities } from './storylets.ts'
import { isQuestion } from './text-match.ts'

const words = (lang: string): string[] =>
  JSON.parse(readFileSync(new URL(`../game/lang/${lang}.json`, import.meta.url), 'utf8')).input.question

// Un joueur en conversation avec un habitué qui n'est ni le détenteur ni
// l'informateur : rien d'autre ne se joue que la réplique.
const talking: Qualities = {
  isCommand: false,
  turn: 2,
  mentionsExit: false,
  exitOpensAtTurn: 0,
  addressesNobody: false,
  talksToNpc: true,
  addressesHolder: false,
  questionsOnly: true,
  asksQuestion: false,
  npcAwaitsAnswer: false,
  citesName: false,
  sceneHasKeyItem: true,
  hasKeyItem: false,
  pendingKeyItem: false,
  missingPiece: false,
  cardDoor: false,
  usesCard: false,
  informed: false,
  holderExchanges: 1,
  exchangesBeforeHandover: 2,
  holderAwaitsOffering: false,
  holderAwaitsPassword: false,
  saysPassword: false,
  failureAtTurn: 10,
  takesReadableObject: false,
  takesUnreadObject: false,
  searchesSpot: false,
  offersItem: false,
  offersWantedItem: false,
  givesOffering: false,
  localAnswer: null,
  canCallModel: true,
}

test('une phrase qui n’est pas une question glisse sur le personnage', () => {
  assert.equal(draw(talking).id, 'sans_question')
})

test('une question part au personnage', () => {
  assert.equal(draw({ ...talking, asksQuestion: true }).id, 'tour')
})

test('répondre à sa question n’a pas besoin d’en être une', () => {
  assert.equal(draw({ ...talking, npcAwaitsAnswer: true }).id, 'tour')
})

test('un don passe toujours, question ou non', () => {
  assert.equal(draw({ ...talking, offersItem: true, offersWantedItem: true }).id, 'don')
})

test('le réglage éteint, tout part au personnage', () => {
  assert.equal(draw({ ...talking, questionsOnly: false }).id, 'tour')
})

test('reconnaît une question avec ou sans point d’interrogation', () => {
  const fr = words('fr')
  assert.ok(isQuestion('Kaneshi, tu bois quoi ?', fr))
  assert.ok(isQuestion('pourquoi tu restes là', fr))
  assert.ok(isQuestion('sais-tu qui garde le module', fr))
  assert.ok(isQuestion('dis-moi ce que tu as vu', fr))
  assert.ok(!isQuestion('Bonjour Kaneshi', fr))
  assert.ok(!isQuestion('je cherche le module', fr))
  assert.ok(isQuestion('why are you here', words('en')))
  assert.ok(!isQuestion('hello there', words('en')))
  assert.ok(isQuestion('你为什么在这里', words('zh')))
  assert.ok(isQuestion('¿Quién eres', words('es')))
  assert.ok(isQuestion('هل تعرفه', words('ar')))
})

// LE RYTHME D'UN PERSONNAGE QUI GARDE UN OBJET, dans toutes les scènes où un
// personnage le garde : 1. le joueur l'engage par une question ; 2. il répond
// et pose SA question ; 3. le joueur répond, question ou pas ; 4. il commente
// et tend l'objet. Le moteur ne distingue pas les scènes : seul le compte
// `exchanges_before_handover` pourrait le décaler.
const script = JSON.parse(readFileSync(new URL('../game/script.json', import.meta.url), 'utf8'))
const holderScenes = script.scenes.filter((s: any) => s.key_item?.acquisition && s.key_item.acquisition !== 'found')

test('chaque scène à détenteur cède l’objet au deuxième échange', () => {
  assert.ok(holderScenes.length > 0)
  for (const s of holderScenes) assert.equal(s.key_item.exchanges_before_handover, 2, s.id)
})

test('question, question en retour, réponse, remise', () => {
  const holder: Qualities = { ...talking, addressesHolder: true, informed: false, holderExchanges: 1 }
  // 1. Une phrase qui n'engage pas : il ne relève pas, rien ne se compte.
  assert.equal(draw(holder).id, 'sans_question')
  // 1. Une question l'engage : un tour, où il répond et pose la sienne.
  assert.equal(draw({ ...holder, asksQuestion: true }).id, 'tour')
  // 3. Le joueur répond à sa question, même sans « ? » : il commente et cède.
  const answering: Qualities = { ...holder, informed: true, holderExchanges: 2, npcAwaitsAnswer: true }
  assert.equal(draw(answering).id, 'remise')
  // Même s'il répond par une question, ou de travers : pas de mauvaise réponse.
  assert.equal(draw({ ...answering, asksQuestion: true, npcAwaitsAnswer: false }).id, 'remise')
})

// A3S1 : le détenteur ne cède la carte que contre l'offrande posée dans le
// décor. Parler ne suffit plus ; la lui tendre suffit, même au dernier tour.
test('là où il attend une offrande, seul le don remet la carte', () => {
  const holder: Qualities = {
    ...talking, addressesHolder: true, informed: true, holderExchanges: 3,
    npcAwaitsAnswer: true, holderAwaitsOffering: true,
  }
  assert.equal(draw(holder).id, 'tour')
  const giving: Qualities = { ...holder, offersItem: true, offersWantedItem: true, givesOffering: true }
  const remise = draw(giving)
  assert.equal(remise.id, 'remise_contre_offrande')
  assert.deepEqual(remise.after, ['consume_given_item', 'offer_key_item'])
  assert.equal(draw({ ...giving, turn: 9 }).id, 'remise_contre_offrande')
  // Un autre objet, ou à quelqu'un d'autre : le don ordinaire, sans carte.
  assert.equal(draw({ ...giving, givesOffering: false }).id, 'don')
})

// LE MÊME RYTHME POUR TOUS : l'informateur et les habitués ordinaires
// demandent d'abord (une question sur la quête), puis donnent — le nom du
// détenteur pour l'un, son morceau du dehors pour les autres.
test('tout personnage renvoie une question avant de donner', () => {
  const t = script.defaults.turn
  assert.equal(t.exchanges_before_steer, 2)
  assert.match(t.npc_dialogue_prompt, /\{\{rhythm_rule\}\}/)
  assert.match(t.npc_ask_rule, /UNE question/)
  assert.match(t.npc_give_rule, /commente sa réponse/)
  assert.match(t.informant_warmup_prompt, /TERMINE par cette question/)
  assert.match(t.informant_prompt, /la commente/)
})

// Chaque personnage se présente par sa posture, son caractère et son rôle dans
// la quête, et ce rôle se tire du dossier.
test('posture, caractère, rôle tiré du dossier', () => {
  const npc = script.defaults.generation.output_schema.npcs[0]
  assert.match(npc.role, /dossier/)
  for (const k of ['npc_dialogue_prompt', 'holder_prompt', 'informant_prompt', 'informant_warmup_prompt', 'handover_prompt']) {
    assert.match(script.defaults.turn[k], /\{\{role_rule\}\}/, k)
  }
  const presents = (s: string) => /POSTURE/.test(s) && /CARACTÈRE/.test(s) && /`role`/.test(s)
  assert.ok(presents(script.defaults.narrative.structure[4]))
  assert.ok(script.scenes[0].narrative.structure.some(presents))
})

test('la relique ne se cède qu’à qui dit la formule', () => {
  const holder = { ...talking, talksToNpc: true, addressesHolder: true, sceneHasKeyItem: true, informed: true, holderAwaitsPassword: true }
  assert.notEqual(draw({ ...holder, saysPassword: false }).id, 'remise')
  assert.equal(draw({ ...holder, saysPassword: true }).id, 'remise')
})
