import assert from 'node:assert/strict'
import test from 'node:test'

import { isSecondLook } from './puzzle-look.ts'

test('le premier objet ne livre pas la fréquence', () => {
  assert.equal(isSecondLook('Écran', [], false), false)
})

test('un second objet distinct livre la fréquence', () => {
  assert.equal(isSecondLook('Plaque', ['Écran'], false), true)
})

test('regarder deux fois le même objet ne livre pas la fréquence', () => {
  assert.equal(isSecondLook('Écran', ['Écran'], false), false)
})