import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spaceParagraphs } from './paragraphs.ts'

test('un saut seul devient une ligne vide', () => {
  assert.equal(spaceParagraphs('Un.\nDeux.'), 'Un.\n\nDeux.')
})

test('les sauts multiples et les blancs entre eux se réduisent à une ligne vide', () => {
  assert.equal(spaceParagraphs('Un.\n \n\n  Deux.'), 'Un.\n\nDeux.')
})

test('le texte en cours de flux reste un préfixe du texte complet', () => {
  const full = spaceParagraphs('Un.\nDeux.')
  assert.ok(full.startsWith(spaceParagraphs('Un.\n')))
  assert.ok(full.startsWith(spaceParagraphs('Un.')))
})

test('un texte sans saut ne change pas', () => {
  assert.equal(spaceParagraphs('Un. Deux.'), 'Un. Deux.')
})

test('les blancs du flux ne cassent pas le préfixe', () => {
  const full = spaceParagraphs('Un. \n \nDeux.')
  for (const partial of ['Un. ', 'Un. \n', 'Un. \n ', 'Un. \n \n']) {
    assert.ok(full.startsWith(spaceParagraphs(partial)), partial)
  }
})
