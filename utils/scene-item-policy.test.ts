import assert from 'node:assert/strict'
import test from 'node:test'
import { sceneKeyInventoryKind, finalSequenceNeedsExchange } from './scene-item-policy.ts'

test('l’objet personnel a3s1 entre dans l’inventaire comme objet échangeable, non comme carte', () => {
  assert.equal(sceneKeyInventoryKind('a3s1'), 'trade')
  assert.equal(sceneKeyInventoryKind('a2s2'), 'key')
})

test('l’échange facultatif ne bloque pas la séquence finale, même sans don', () => {
  assert.equal(finalSequenceNeedsExchange([]), false)
  assert.equal(finalSequenceNeedsExchange(['cle_a3s1']), false)
})
