#!/usr/bin/env bash
# Install a fixed Beezy release and a private, fixed pi version. No sudo required.
set -euo pipefail
BEEZY_VERSION=beezy-v0.1.0
PI_VERSION=0.85.1
INSTALL_DIR="${BEEZY_INSTALL_DIR:-$HOME/.local/share/beezy}"
for command in node npm git; do
  command -v "$command" >/dev/null || { echo "Required: $command (Node.js >=22.19)." >&2; exit 1; }
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22 && b<19)) process.exit(1)' || { echo 'Node.js >=22.19 required.' >&2; exit 1; }
if [[ -e "$INSTALL_DIR" ]]; then
  echo "Refusing to overwrite $INSTALL_DIR. Set BEEZY_INSTALL_DIR to a new directory." >&2
  exit 1
fi
# Leave failed installations available for inspection; never delete user files.
mkdir -p "$(dirname "$INSTALL_DIR")"
git clone --depth 1 --branch "$BEEZY_VERSION" https://github.com/PAndreew/pi_group.git "$INSTALL_DIR"
cd "$INSTALL_DIR"
npm install --prefix .runtime --save-exact --no-audit --no-fund "@earendil-works/pi-coding-agent@$PI_VERSION"
# Builds require TypeScript and other dev dependencies even with NODE_ENV=production.
npm_config_include=dev npm_config_audit=false npm_config_fund=false npm run setup
npm run build
mkdir -p workspace
# Configuration contains a generated password, readable only by the installing user.
umask 077
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
const root = process.cwd();
const value = v => JSON.stringify(v);
const password = randomBytes(18).toString('base64url');
writeFileSync('.env', [
  'HOST=127.0.0.1', 'PORT=8787',
  `FS_ROOT=${value(path.join(root, 'workspace'))}`,
  `DATA_DIR=${value(path.join(root, '.data'))}`,
  `PI_BIN=${value(path.join(root, '.runtime/node_modules/.bin/pi'))}`,
  `ADMIN_PASSWORD=${password}`, 'ENABLE_DURABLE=false', '',
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log(`\nInstalled Beezy. Login: admin / ${password}`);
NODE
printf '\nNext: authenticate pi, then start Beezy:\n  cd %q\n  .runtime/node_modules/.bin/pi   # /login, then /quit\n  npm start\n\nOpen http://localhost:8787 (bound to localhost for safety).\nTo allow LAN access, set HOST=0.0.0.0 in .env.\n' "$INSTALL_DIR"
