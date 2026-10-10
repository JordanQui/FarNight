import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FRAMING, place } from './instagram-crop.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)

test('a centred square crop of a 2:3 source keeps the full width', () => {
  const { src, dst } = place(1024, 1536, 1080, 1080, DEFAULT_FRAMING)
  near(src.w, 1024)
  near(src.h, 1024)
  near(src.x, 0)
  near(src.y, 256)
  assert.deepEqual(dst, { x: 0, y: 0, w: 1080, h: 1080 })
})

test('a 9:16 crop of a 2:3 source keeps the full height and trims the sides', () => {
  const { src } = place(1024, 1536, 1080, 1920, DEFAULT_FRAMING)
  near(src.h, 1536)
  near(src.w, 1536 * 1080 / 1920)
  near(src.x, (1024 - src.w) / 2)
})

test('the focal point slides the crop without leaving the source', () => {
  const top = place(1024, 1536, 1080, 1350, { ...DEFAULT_FRAMING, y: 0 })
  const bottom = place(1024, 1536, 1080, 1350, { ...DEFAULT_FRAMING, y: 1 })
  near(top.src.y, 0)
  near(bottom.src.y + bottom.src.h, 1536)
  // Hors bornes : ramené au bord.
  near(place(1024, 1536, 1080, 1350, { ...DEFAULT_FRAMING, y: 7 }).src.y, bottom.src.y)
})

test('zoom tightens the crop around the focal point', () => {
  const { src } = place(1024, 1536, 1080, 1080, { ...DEFAULT_FRAMING, zoom: 2 })
  near(src.w, 512)
  near(src.x, 256)
})

test('fit shows the whole source, letterboxed', () => {
  const { src, dst } = place(1024, 1536, 1080, 1920, { ...DEFAULT_FRAMING, mode: 'fit' })
  assert.deepEqual(src, { x: 0, y: 0, w: 1024, h: 1536 })
  near(dst.w, 1080)
  near(dst.h, 1620)
  near(dst.y, 150)
})

test('fit zoom stops once the frame is covered', () => {
  const { dst } = place(1024, 1536, 1080, 1920, { ...DEFAULT_FRAMING, mode: 'fit', zoom: 4 })
  near(dst.h, 1920)
  near(dst.w, 1024 * 1920 / 1536)
})
