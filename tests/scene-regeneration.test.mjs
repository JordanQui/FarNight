import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('a reload puts back the stored scene before asking for a new one', () => {
  const scene = source('composables/useScene.ts')
  assert.match(scene, /async function loadSceneText[\s\S]*?readStoredScene\([\s\S]*?\$fetch<SceneTextResponse>\('\/api\/scene\/text'/)
  assert.match(scene, /storeScene\(res, /)
})

test('a reload puts back the stored image before generating one', () => {
  const scene = source('composables/useScene.ts')
  assert.match(scene, /async function loadSceneImage[\s\S]*?readSceneImage\([\s\S]*?generateSceneImage\(/)
  assert.match(scene, /storeSceneImage\(stamp, image\)/)
})

test('a reload keeps the turns already played in the scene', () => {
  const scene = source('composables/useScene.ts')
  assert.match(scene, /turnCount: game\.turnCount/)
  assert.match(scene, /narrative: game\.narrativeHistory/)
})
