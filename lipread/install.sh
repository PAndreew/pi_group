#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$HOME/.local/share/beezy-lipread"
mkdir -p "$RUNTIME" "$HOME/.config/beezy-lipread" "$HOME/.config/systemd/user"
chmod 700 "$HOME/.config/beezy-lipread"
command -v ffmpeg >/dev/null || { echo 'Install ffmpeg first.' >&2; exit 1; }
node "$ROOT/web/scripts/setup-lipread.mjs"
python3 -m venv "$RUNTIME/.venv"
"$RUNTIME/.venv/bin/pip" install --no-cache-dir -r "$ROOT/lipread/requirements.txt"
cp "$ROOT/lipread/worker.py" "$RUNTIME/worker.py"
cp "$ROOT/deploy/beezy-lipread.service" "$HOME/.config/systemd/user/beezy-lipread.service"
python3 - "$ROOT" <<'PY'
from pathlib import Path
import os, re, secrets, sys
root = Path(sys.argv[1])
config = Path.home() / '.config/beezy-lipread/runtime.env'
previous = config.read_text() if config.exists() else ''
match = re.search(r'^LIPREAD_SERVICE_TOKEN=([a-f0-9]{64})$', previous, re.M)
token = match.group(1) if match else secrets.token_hex(32)
config.write_text('LIPREAD_SERVICE_TOKEN=' + token + '\nLIPREAD_MODEL_DIR=' + str(Path.home() / '.local/share/beezy-lipread/models') + '\n')
os.chmod(config, 0o600)
env = root / '.env'
text = env.read_text() if env.exists() else ''
for key, value in {'LIPREAD_SERVICE_URL': 'http://127.0.0.1:8792', 'LIPREAD_SERVICE_TOKEN': token}.items():
    text = re.sub(r'^' + key + r'=.*\n?', '', text, flags=re.M)
    text = text.rstrip() + '\n' + key + '=' + value + '\n'
env.write_text(text); os.chmod(env, 0o600)
PY
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user daemon-reload
systemctl --user enable --now beezy-lipread.service
echo 'Native lip reader installed. Restart/deploy Beezy to load the private proxy credentials.'
