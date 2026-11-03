// Test exactly the current source suite, not stale .test.js files from previous builds.
import { readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const files = readdirSync('src').filter(name => name.endsWith('.test.ts') && name !== 'terminal.test.ts').sort().map(name => `dist/${name.slice(0, -3)}.js`)
if (!files.length || files.some(file => !existsSync(file))) throw new Error('Run npm run build before test:deploy')
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
