import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChart, previewUrls } from '../src/lib/rich-blocks.ts'

test('chart blocks parse into a clean spec', () => {
  const spec = parseChart('{"type":"line","title":"Sales","x":["Q1","Q2","Q3"],"series":[{"name":"EU","data":[1,"2",null]},{"data":[3]}],"unit":"€","stacked":true}')
  assert.deepEqual(spec, { type: 'line', title: 'Sales', x: ['Q1', 'Q2', 'Q3'], series: [{ name: 'EU', data: [1, 2, null] }, { name: 'Series 2', data: [3, null, null] }], unit: '€', stacked: true })
})

test('a list of label/value rows is a one-series bar chart', () => {
  const spec = parseChart('{"title":"Langs","data":[{"label":"TS","value":5},{"label":"Go","value":2}]}')
  assert.equal(spec.type, 'bar')
  assert.deepEqual(spec.x, ['TS', 'Go'])
  assert.deepEqual(spec.series, [{ name: 'Langs', data: [5, 2] }])
  assert.equal(spec.stacked, false)
})

test('broken or incomplete chart blocks explain themselves', () => {
  assert.match(parseChart('{"type":"bar","x":['), /JSON/)
  assert.match(parseChart('{"type":"pie","x":["a"],"series":[{"data":[1]}]}'), /pie/)
  assert.match(parseChart('{"x":[]}'), /needs/)
})

test('preview blocks list web links only', () => {
  assert.deepEqual(previewUrls('https://a.com/x\n  http://b.org \nnot a link\njavascript:alert(1)'), ['https://a.com/x', 'http://b.org'])
})
