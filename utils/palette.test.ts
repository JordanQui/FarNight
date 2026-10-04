import assert from 'node:assert/strict'
import test from 'node:test'
import type { UserProfile } from '../types/user.ts'
import { deterministicPaletteHexes, rgbToHsl, hexToRgb } from './palette.ts'

function profile(moment: string): UserProfile {
  return {
    identity: { name: 'Camille Martin' },
    origin: { hometown: { name: 'Paris' } },
    trajectory: { turning_points: [] },
    touchstones: { moment },
  }
}

test('an explicit blue light yields the same hue across scenes', () => {
  const first = deterministicPaletteHexes(profile('une lumière bleue'), 'a1s1')
  const last = deterministicPaletteHexes(profile('une lumière bleue'), 'a3s2')
  assert.equal(first.accent, last.accent)
  assert.ok(Math.abs(rgbToHsl(hexToRgb(first.accent)).h - 0.59) < 0.01)
})

test('equivalent colour words and casing lead to the same answer', () => {
  assert.equal(
    deterministicPaletteHexes(profile('LUMIÈRE BLEUE'), 'a2s1').accent,
    deterministicPaletteHexes(profile('lumière bleu'), 'a2s1').accent,
  )
})

test('without an explicit colour the scenes still have distinct card accents', () => {
  assert.notEqual(
    deterministicPaletteHexes(profile('le calme du soir'), 'a1s1').accent,
    deterministicPaletteHexes(profile('le calme du soir'), 'a2s1').accent,
  )
})
