import assert from 'node:assert/strict'
import test from 'node:test'

import { aimFrom, upVector } from './gyro-aim.ts'

test('la position allongée choisie au repos centre le curseur', () => {
  const rest = upVector(132, 18)
  assert.deepEqual(aimFrom(rest, 90, 15.4, 0.5, 0.75, rest), { x: 0.5, y: 0.5 })
})

test('la position assise conserve son origine absolue', () => {
  assert.deepEqual(aimFrom(upVector(0, 0), 0, 22, 0.05), { x: 0.5, y: 0.05 })
})

test('le passage de 179° à -179° ne fait pas sauter le viseur', () => {
  const rest = upVector(179, 0)
  const aim = aimFrom(upVector(-179, 0), 90, 15.4, 0.5, 0.75, rest)
  assert.ok(aim.y > 0.5 && aim.y < 0.6)
})