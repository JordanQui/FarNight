import assert from 'node:assert/strict'
import test from 'node:test'
import { sceneKeyInventoryKind, finalSequenceNeedsExchange, keyItemNameInClear } from './scene-item-policy.ts'

test('l’objet personnel A2S1 peut être donné au PNJ d’A2S2', () => {
  assert.equal(sceneKeyInventoryKind('a2s1'), 'trade')
})

test('A3S1 redevient une carte pour atteindre le dernier lieu', () => {
  assert.equal(sceneKeyInventoryKind('a3s1'), 'key')
})

test('A2S2 conserve sa carte gagnée sur le lecteur', () => {
  assert.equal(sceneKeyInventoryKind('a2s2'), 'key')
})

test('la séquence finale ne dépend pas de l’objet donné en A2S2', () => {
  assert.equal(finalSequenceNeedsExchange([]), false)
  assert.equal(finalSequenceNeedsExchange(['cle_a2s1']), false)
})

test('ce qu’un personnage tend se lit en clair, ce que le décor cache se déchiffre', () => {
  assert.equal(keyItemNameInClear('holder'), true)
  assert.equal(keyItemNameInClear('informant_then_holder'), true)
  assert.equal(keyItemNameInClear('found'), false)
})
