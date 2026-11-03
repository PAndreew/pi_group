// Optional non-commercial research model. Downloaded for the native service, never the browser.
import { mkdir, rename, rm } from 'node:fs/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
const out = process.env.LIPREAD_MODEL_DIR || join(homedir(), '.local/share/beezy-lipread/models')
await mkdir(out, { recursive: true })
const repo = 'https://huggingface.co/eschmechel/auto-avsr-lrs3-vsr-int8-onnx/resolve/9359b251b8d9b8e2d63bada99013bb92eee3b087/'
async function hash(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex') }
for (const [name, sha] of [
  ['lipread_ctc.int8.onnx', 'da02d72ee472eb3d7d50f7dd309bfe81973acb4cac8bb770dd86aa97872f195b'],
  ['tokens.json', '97f0f20cfebadaf51f7cdb9e7a26835fa0fbd6a956701434e899a4f9934d979c'], // gitleaks:allow -- public vocabulary SHA-256
]) {
  const target = join(out, name)
  if (await hash(target).catch(() => '') === sha) continue
  console.log('Downloading', name)
  const response = await fetch(repo + name, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`)
  const temporary = target + '.part'
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
  if (await hash(temporary) !== sha) { await rm(temporary); throw new Error(`Checksum mismatch: ${name}`) }
  await rename(temporary, target)
}
console.log('Native lip-reading model ready in', out)
