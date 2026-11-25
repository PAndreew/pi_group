import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const dir = new URL('../src/locales/', import.meta.url)
const files = (await readdir(dir)).filter((file) => file.endsWith('.json'))
const catalogs = Object.fromEntries(await Promise.all(files.map(async (file) => [file.slice(0, -5), JSON.parse(await readFile(new URL(file, dir), 'utf8'))])))
const reference = catalogs.en.messages
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
for (const [locale, catalog] of Object.entries(catalogs)) {
  assert.ok(catalog.name, `${locale}: missing language name`)
  for (const [key, value] of Object.entries(catalog.messages)) {
    assert.ok(Object.hasOwn(reference, key), `${locale}: unknown key ${key}`)
    assert.equal(typeof value, 'string', `${locale}: ${key} must be text`)
    assert.ok(value.trim(), `${locale}: ${key} must not be empty`)
    assert.deepEqual(placeholders(value), placeholders(reference[key]), `${locale}: ${key} must preserve placeholders`)
  }
}
assert.deepEqual(Object.keys(catalogs.hu.messages).sort(), Object.keys(reference).sort(), 'Hungarian catalog must cover every English key')
console.log(`Checked ${Object.keys(reference).length} messages in ${files.length} catalogs`)
