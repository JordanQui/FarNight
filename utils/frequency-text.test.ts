import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureFrequencyTarget } from './frequency-text.ts'

test('la fréquence oubliée par le récit devient ouvrable sur le focal', () => {
  const scene = { scene_text: 'La console pulse. La porte reste close.', key_item: { name: 'Fréquence Complice' }, decor: [{ slot_id: 'focal', name: 'console' }] }
  ensureFrequencyTarget(scene)
  assert.equal(scene.scene_text, 'La console (Fréquence Complice) pulse. La porte reste close.')
})

test('la fréquence déjà nommée reste inchangée', () => {
  const scene = { scene_text: 'La Fréquence Complice pulse.', key_item: { name: 'Fréquence Complice' }, decor: [{ slot_id: 'focal', name: 'console' }] }
  ensureFrequencyTarget(scene)
  assert.equal(scene.scene_text, 'La Fréquence Complice pulse.')
})

test('un focal non cité reçoit un nom visible plutôt que bloquer la scène', () => {
  const scene = { scene_text: 'Le quai est vide.', key_item: { name: 'Fréquence Complice' }, decor: [{ slot_id: 'focal', name: 'Console' }] }
  ensureFrequencyTarget(scene)
  assert.equal(scene.scene_text, 'Le quai est vide.\n\nConsole : Fréquence Complice.')
})
