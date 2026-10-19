import assert from 'node:assert/strict'
import test from 'node:test'
import { fileLinkPath } from '../src/lib/file-link.ts'

test('relative links resolve against the folder', () => {
  assert.equal(fileLinkPath('report.md', 'proj'), 'proj/report.md')
  assert.equal(fileLinkPath('./out/My%20chart.png', 'proj/a'), 'proj/a/out/My chart.png')
  assert.equal(fileLinkPath('../notes.md', 'proj/a'), 'proj/notes.md')
  assert.equal(fileLinkPath('notes.md', ''), 'notes.md')
})
test('web links, anchors and escapes are not files', () => {
  assert.equal(fileLinkPath('https://example.com/a.md', 'proj'), undefined)
  assert.equal(fileLinkPath('mailto:a@b.c', 'proj'), undefined)
  assert.equal(fileLinkPath('#top', 'proj'), undefined)
  assert.equal(fileLinkPath('../../x.md', 'proj'), undefined)
})
test('absolute paths only inside the shared root', () => {
  assert.equal(fileLinkPath('/srv/share/proj/a.md', 'other', '/srv/share'), 'proj/a.md')
  assert.equal(fileLinkPath('file:///srv/share/a.md', '', '/srv/share/'), 'a.md')
  assert.equal(fileLinkPath('/etc/passwd', 'proj', '/srv/share'), undefined)
  assert.equal(fileLinkPath('/srv/share/a.md', 'proj'), undefined)
  assert.equal(fileLinkPath('C:\\Share\\proj\\a.md', '', 'c:\\share'), 'proj/a.md')
})
