#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# This app uses the user service, never the system service or pi-web.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
SERVICE=pi-group.service
URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8788/}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Deployment refused: commit or stash local changes first.' >&2
  exit 1
fi
working_dir="$(systemctl --user show "$SERVICE" --property=WorkingDirectory --value)"
if [[ "$working_dir" != "$ROOT/server" ]]; then
  echo "Deployment refused: $SERVICE targets '$working_dir', expected '$ROOT/server'." >&2
  exit 1
fi

git pull --ff-only
npm run setup
npm run build
# Do not interrupt the running service unless installation and build succeeded.
systemctl --user restart "$SERVICE"
for attempt in {1..30}; do
  if systemctl --user is-active --quiet "$SERVICE" && curl --fail --silent --output /dev/null "$URL"; then
    echo "Deployed $(git rev-parse --short HEAD): user service $SERVICE; HTTP OK at $URL"
    exit 0
  fi
  sleep 1
done
systemctl --user status "$SERVICE" --no-pager >&2 || true
echo "Deployment failed health check: $URL" >&2
exit 1
