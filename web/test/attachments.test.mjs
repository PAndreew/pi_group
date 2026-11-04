import assert from 'node:assert/strict'
import test from 'node:test'
import { fileParts, imageRefs, uploadDir, withoutAttachmentList } from '../src/lib/attachments.ts'

test('uploads go into the folder the conversation works in', () => {
  assert.equal(uploadDir('projects/site'), 'projects/site/uploads')
  assert.equal(uploadDir(''), 'uploads')
})

test('images are found in path tokens and in the agent attachment list', () => {
  assert.deepEqual(imageRefs('look `pi-chat/uploads/a.png` and `notes.md`'), ['pi-chat/uploads/a.png'])
  const prompt = 'See this\n\nAttached files (relative to the working directory):\n- uploads/b.JPG\n- uploads/data.csv'
  assert.deepEqual(imageRefs(prompt, 'projects/site'), ['projects/site/uploads/b.JPG'])
  assert.equal(withoutAttachmentList(prompt), 'See this\n\nAttached files:\n- uploads/data.csv')
  assert.equal(withoutAttachmentList('Hi\n\nAttached files (relative to the working directory):\n- uploads/b.png'), 'Hi')
})

test('file paths in a message become links, inline code stays text', () => {
  assert.deepEqual(fileParts('see `pi-chat/uploads/report final.pdf` and run `npm i`'), [
    { text: 'see ' }, { path: 'pi-chat/uploads/report final.pdf' }, { text: ' and run `npm i`' },
  ])
  assert.deepEqual(fileParts('Hi\n\nAttached files:\n- uploads/data.csv', 'projects/site'), [
    { text: 'Hi\n\nAttached files:\n- ' }, { path: 'projects/site/uploads/data.csv' },
  ])
  assert.deepEqual(fileParts('plain'), [{ text: 'plain' }])
})
