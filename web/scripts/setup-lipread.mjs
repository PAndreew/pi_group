// Optional, non-commercial research model. No executable code is fetched from the model repo.
import { mkdir, writeFile, copyFile, readdir, rename, rm } from 'node:fs/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const out = `${root}public/lipread/`
await mkdir(out, { recursive: true })
const repo = 'https://huggingface.co/eschmechel/auto-avsr-lrs3-vsr-int8-onnx/resolve/9359b251b8d9b8e2d63bada99013bb92eee3b087/'
async function hash(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex') }
for (const [name, url, sha] of [
  ['lipread_ctc.int8.onnx', repo + 'lipread_ctc.int8.onnx', 'da02d72ee472eb3d7d50f7dd309bfe81973acb4cac8bb770dd86aa97872f195b'],
  ['tokens.json', repo + 'tokens.json', '97f0f20cfebadaf51f7cdb9e7a26835fa0fbd6a956701434e899a4f9934d979c'], // gitleaks:allow -- public vocabulary SHA-256, not a credential
  ['blaze_face_short_range.tflite', 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite', null],
]) {
  if (sha && await hash(out + name).catch(() => '') === sha) continue
  console.log('Downloading', name)
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`)
  const temp = out + name + '.part'
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temp))
  if (sha && await hash(temp) !== sha) { await rm(temp); throw new Error(`Checksum mismatch: ${name}`) }
  await rename(temp, out + name)
}
for (const [dir, target] of [['node_modules/onnxruntime-web/dist', 'ort'], ['node_modules/@mediapipe/tasks-vision/wasm', 'mediapipe']]) {
  await mkdir(out + target, { recursive: true })
  for (const name of await readdir(root + dir)) {
    const needed = target === 'ort' ? /^ort-wasm-simd-threaded\.(mjs|wasm)$/.test(name) : /\.(wasm|js)$/.test(name)
    if (needed) await copyFile(`${root}${dir}/${name}`, `${out}${target}/${name}`)
  }
}
await writeFile(out + 'ready.json', JSON.stringify({ model: 'auto-avsr-lrs3-vsr-int8-onnx', revision: '9359b251b8d9b8e2d63bada99013bb92eee3b087' }))
console.log('Lip-reading assets ready. Run npm run build to include them.')
