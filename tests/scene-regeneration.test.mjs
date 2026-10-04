import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('a reload always requests fresh scene text without reading or writing a cached scene', () => {
  const scene = source('composables/useScene.ts')
  assert.match(scene, /async function loadSceneText[\s\S]*?forgetStoredScene\(\)[\s\S]*?\$fetch<SceneTextResponse>\('\/api\/scene\/text'/)
  assert.doesNotMatch(scene, /readStoredScene|storeScene\(res|SCENE_CACHE/)
})

test('a reload regenerates the non-static image instead of replaying a saved image', () => {
  const scene = source('composables/useScene.ts')
  assert.match(scene, /async function loadSceneImage[\s\S]*?return generateSceneImage\(/)
  assert.doesNotMatch(scene, /readSceneImage|storeSceneImage/)
})

test('scene and image endpoints never reuse development mocks', () => {
  for (const endpoint of ['text', 'image']) {
    const code = source(`server/api/scene/${endpoint}.post.ts`)
    assert.doesNotMatch(code, /readMock|writeMock|mockKey/)
  }
})
