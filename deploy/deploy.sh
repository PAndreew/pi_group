#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
cd "$ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Deployment refused: commit or stash local changes first (untracked files too).' >&2
  exit 1
fi
if [[ "${1:-}" != '' && "${1:-}" != '--bootstrap' ]]; then
  echo 'Usage: npm run deploy -- [--bootstrap]' >&2; exit 1
fi
# No pull: deploy exactly the reviewed local commit, never an unexpected remote update.
ref="$(git rev-parse HEAD)"
unit="beezy-deploy-$(date +%Y%m%d-%H%M%S)-$$"
systemd-run --user --unit="$unit" --collect --property=Type=exec \
  /bin/bash "$ROOT/deploy/release.sh" "$ROOT" "$ref" "${1:-}"
echo "Deployment queued outside Beezy's service. Follow: journalctl --user -fu $unit"
echo 'The controller survives this chat/server restarting. No vault or pi-web restart.'
