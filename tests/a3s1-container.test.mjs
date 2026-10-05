import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('A3S1 exige un contenant fouillable qui révèle une offrande à troquer', () => {
  const script = JSON.parse(readFileSync(new URL('../game/script.json', import.meta.url), 'utf8'))
  const scene = script.scenes.find(({ id }) => id === 'a3s1')
  assert.ok(scene.interactables.instruction.includes('CONTENANT'))
  assert.ok(scene.interactables.instruction.includes("révèle l'offrande"))
  assert.ok(scene.key_item.instruction.includes('contenant du lieu'))
})

test('le moteur relie l’analyse du contenant à l’offrande cachée', () => {
  const runtime = readFileSync(new URL('../utils/script-runtime.ts', import.meta.url), 'utf8')
  const shell = readFileSync(new URL('../components/game/GameShell.vue', import.meta.url), 'utf8')
  assert.match(runtime, /container\.contains_id = OFFERING_ID/)
  assert.match(runtime, /offering\.hidden = true/)
  assert.match(shell, /revealInteractable\(container\.contains_id\)/)
})