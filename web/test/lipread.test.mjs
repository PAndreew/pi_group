import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeCTC, fillLandmarks, similarity, smoothLandmarks } from '../src/lib/lipread-math.ts'

test('CTC collapses repeats but blank separates repeated tokens', () => {
  const tokens = ['<blank>', '▁HI', '▁YOU', '<eos>']
  const ids = [0, 1, 1, 0, 1, 2, 2, 3]
  const logits = Float32Array.from(ids.flatMap(id => tokens.map((_, j) => id === j ? 0 : -10)))
  assert.equal(decodeCTC(logits, tokens), 'HI HI YOU')
})
test('landmarks interpolate gaps and extend edges', () => {
  assert.deepEqual(fillLandmarks([null, [[0, 0]], null, [[4, 2]], null]), [[[0, 0]], [[0, 0]], [[2, 1]], [[4, 2]], [[4, 2]]])
  assert.throws(() => fillLandmarks([null]), /No face/)
})
test('similarity recovers rotation, scale and translation', () => {
  const source = [[0, 0], [1, 0], [0, 1], [1, 1]]
  const target = source.map(([x, y]) => [2*x-y+7, x+2*y-3])
  const t = similarity(source, target)
  for (const [k, v] of Object.entries({ a: 2, b: 1, tx: 7, ty: -3 })) assert.ok(Math.abs(t[k] - v) < 1e-6)
})
test('smoothing preserves per-frame landmark centre', () => {
  const frames = Array.from({ length: 15 }, (_, i) => [[i, i], [i + 2, i + 4]])
  assert.deepEqual(smoothLandmarks(frames, 7), frames[7])
})
