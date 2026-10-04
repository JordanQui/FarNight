import assert from 'node:assert/strict'
import test from 'node:test'
import { canChimeName } from './name-chime-policy.ts'

test('the eye can sound a name even after it has been deciphered', () => {
  assert.equal(canChimeName(true, false, 'eye'), true)
})

test('a closed eye cannot sound a name', () => {
  assert.equal(canChimeName(false, false, 'eye'), false)
})

test('the lens cannot sound a name', () => {
  assert.equal(canChimeName(true, false, 'lens'), false)
})
