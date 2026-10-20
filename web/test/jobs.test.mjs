import assert from 'node:assert/strict'
import test from 'node:test'
import { blankStep, formatHeaders, jobStatus, parseHeaders } from '../src/lib/jobs.ts'

test('headers round-trip through "Name: value" lines', () => {
  const headers = { Accept: 'application/json', Authorization: 'Bearer a:b' }
  assert.deepEqual(parseHeaders(formatHeaders(headers)), headers)
  assert.deepEqual(parseHeaders('X-Half\n: no name\nX-Ok: 1'), { 'X-Ok': '1' })
})

test('a new step has the defaults the server expects', () => {
  assert.deepEqual(blankStep('script'), { type: 'script', command: '', timeoutSec: 60 })
  assert.deepEqual(blankStep('http'), { type: 'http', method: 'GET', url: '', headers: {}, timeoutSec: 30 })
})

test('status puts running and approval before the rest', () => {
  const job = { running: false, approved: true, enabled: true, lastRun: { ok: false } }
  assert.equal(jobStatus({ ...job, running: true, approved: false }), 'running')
  assert.equal(jobStatus({ ...job, approved: false }), 'approval')
  assert.equal(jobStatus({ ...job, enabled: false }), 'paused')
  assert.equal(jobStatus(job), 'failing')
  assert.equal(jobStatus({ ...job, lastRun: undefined }), 'active')
})
