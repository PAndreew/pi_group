#!/usr/bin/env bash
# Offline installer contract checks; dependency installation/build are stubbed.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/bin"
export TEST_LOG="$TMP/commands"
cat > "$TMP/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "$TEST_LOG"
[[ "$*" == 'clone --depth 1 --branch beezy-v0.1.0 https://github.com/PAndreew/pi_group.git '* ]]
mkdir -p "${@: -1}"
SH
cat > "$TMP/bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "$TEST_LOG"
if [[ "$*" == 'run setup' ]]; then
  [[ "$npm_config_include" == dev ]]
fi
SH
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH" BEEZY_INSTALL_DIR="$TMP/install with spaces" NODE_ENV=production
bash "$ROOT/deploy/install.sh" > "$TMP/output"
grep -q '@earendil-works/pi-coding-agent@0.85.1' "$TEST_LOG"
grep -q 'npm run setup' "$TEST_LOG"
grep -q 'npm run build' "$TEST_LOG"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const file = `${process.env.BEEZY_INSTALL_DIR}/.env`;
const env = readFileSync(file, 'utf8');
assert.equal(statSync(file).mode & 0o777, 0o600);
assert.match(env, /HOST=127\.0\.0\.1/);
assert.match(env, /ADMIN_PASSWORD=[\w-]{24}/);
assert.ok(env.includes(`${process.env.BEEZY_INSTALL_DIR}/.runtime/node_modules/.bin/pi`));
assert.ok(env.includes(`${process.env.BEEZY_INSTALL_DIR}/workspace`));
NODE
cp "$BEEZY_INSTALL_DIR/.env" "$TMP/original"
if bash "$ROOT/deploy/install.sh" > "$TMP/retry" 2>&1; then
  echo 'FAIL: existing installation overwritten' >&2
  exit 1
fi
cmp "$TMP/original" "$BEEZY_INSTALL_DIR/.env"
echo 'PASS: pinned versions, production build dependencies, private config, paths with spaces, overwrite refusal'
