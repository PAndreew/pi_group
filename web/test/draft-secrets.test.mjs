import assert from 'node:assert/strict'
import test from 'node:test'
import { findDraftSecrets, redactDraftSecrets, referenceDraftSecret } from '../src/lib/draft-secrets.ts'

const token = `ghp_${'A2'.repeat(18)}`
const ref = key => '{' + `{vault:${key}}}`

test('detects a provider token, preferring a named assignment, and replaces exact repeats', () => {
  const draft = `Use GITHUB_TOKEN="${token}". Again: ${token}`
  assert.deepEqual(findDraftSecrets(draft)[0], { start: draft.indexOf(token), key: 'GITHUB_TOKEN', value: token })
  const updated = referenceDraftSecret(draft, token, 'GITHUB_TOKEN')
  assert.equal(updated, `Use GITHUB_TOKEN="${ref('GITHUB_TOKEN')}". Again: ${ref('GITHUB_TOKEN')}`)
  assert.deepEqual(findDraftSecrets(updated), [])
  assert.equal(redactDraftSecrets(draft).includes(token), false)
})

test('catches a mixed-character value explicitly labelled as a secret in prose', () => {
  const value = '7342dummy-mixed'
  const draft = `Super secret ${value}`
  assert.deepEqual(findDraftSecrets(draft), [{ start: draft.indexOf(value), value, key: 'SECRET' }])
  assert.deepEqual(findDraftSecrets('Super secret project\nSuper secret 1234567890'), [])
})

test('captures complete private keys and quoted credential values', () => {
  const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\na-fake-example\n-----END OPENSSH PRIVATE KEY-----'
  const draft = `\`\`\`\n${pem}\n\`\`\`\npassword: "test with spaces"`
  assert.deepEqual(findDraftSecrets(draft).map(({ value }) => value), [pem, 'test with spaces'])
})

test('ordinary documents, command examples, and existing vault references pass through', () => {
  assert.deepEqual(findDraftSecrets(`hello **world** \`reports/uploads/Q4 report.xlsx\`\ncommit 9bd1e92af33255e83796\nAPI_KEY=$API_KEY\napiKey: "your key here"\ntoken=${ref('project:TOKEN')}`), [])
})
