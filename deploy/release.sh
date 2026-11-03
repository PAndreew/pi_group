#!/usr/bin/env bash
# Runs in its own systemd cgroup, never as a descendant of pi-group.service.
set -euo pipefail
umask 077
ROOT="$1"; REF="$2"; BOOTSTRAP="${3:-}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/beezy"
SERVICE=pi-group.service
URL=http://127.0.0.1:8788/healthz
mkdir -p "$STATE/releases"
exec 9>"$STATE/deploy.lock"
flock -n 9 || { echo 'Another deployment is in progress.' >&2; exit 1; }
cd "$ROOT"
working_dir="$(systemctl --user show "$SERVICE" --property=WorkingDirectory --value)"
case "$working_dir" in
  "$ROOT/server"|"$STATE"/releases/*/server) ;;
  *) echo "Refusing to change unrelated service: $working_dir" >&2; exit 1 ;;
esac
RELEASE="$STATE/releases/$(date +%Y%m%d-%H%M%S)-${REF:0:12}-$$"
DRAIN="$STATE/draining"
DROPIN="$HOME/.config/systemd/user/$SERVICE.d/90-beezy-release.conf"
mkdir -p "$RELEASE" "$(dirname "$DROPIN")"
previous="$STATE/previous-dropin"
had_previous=false
if [[ -f "$DROPIN" ]]; then cp "$DROPIN" "$previous"; had_previous=true; fi
switched=false; smoke_pid=''; success=false; legacy=false
cleanup() {
  code=$?
  trap - EXIT INT TERM
  if [[ -n "$smoke_pid" ]]; then kill "$smoke_pid" 2>/dev/null || true; wait "$smoke_pid" 2>/dev/null || true; fi
  rm -f "$DRAIN"
  if $switched && ! $success; then
    echo 'Activation failed; restoring the previous service configuration.' >&2
    if $had_previous; then cp "$previous" "$DROPIN.tmp"; mv "$DROPIN.tmp" "$DROPIN"; else rm -f "$DROPIN"; fi
    systemctl --user daemon-reload
    systemctl --user restart "$SERVICE" || true
    if $legacy; then
      restored=false
      for _ in {1..30}; do
        if systemctl --user is-active --quiet "$SERVICE" && curl --max-time 2 -fsS -o /dev/null http://127.0.0.1:8788/; then restored=true; break; fi
        sleep 1
      done
      if ! $restored; then echo 'ROLLBACK ALSO FAILED: inspect pi-group.service immediately.' >&2; fi
    elif ! wait_health "$URL" ''; then echo 'ROLLBACK ALSO FAILED: inspect pi-group.service immediately.' >&2; fi
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait_health() {
  local url="$1" expected="$2" body
  for _ in {1..90}; do
    if body="$(curl --max-time 2 -fsS "$url" 2>/dev/null)" && \
      printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const h=JSON.parse(s);process.exit(h.ready && (!process.argv[1] || h.release===process.argv[1])?0:1)}catch{process.exit(1)}})' "$expected"; then return 0; fi
    sleep 1
  done
  return 1
}
# Immutable source snapshot: no .env, uploads, or mutable build output from the checkout.
git archive "$REF" | tar -x -C "$RELEASE"
if [[ -f "$ROOT/.env" ]]; then cp "$ROOT/.env" "$RELEASE/.env"; fi
if [[ -f "$ROOT/server/.env" ]]; then cp "$ROOT/server/.env" "$RELEASE/server/.env"; fi
(cd "$RELEASE" && npm run setup && npm run build && timeout 180 npm run test:deploy --prefix server && timeout 90 npm test --prefix web)
# Native lip-reading models live in a separate persistent service, never frontend releases.
# Preserve paths relative to the original server directory when moving to a release.
# Evaluate config only (not the application), from the original working directory.
(cd "$ROOT/server" && node --input-type=module - "$RELEASE" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const release = process.argv[2];
const { config: c } = await import(pathToFileURL(path.join(release, 'server/dist/config.js')).href);
const values = { DATA_DIR: c.dataDir, FS_ROOT: c.fsRoot, CHAT_FOLDER: c.chatFolder, PI_SESSIONS_DIR: c.piSessionsDir, PI_CODING_AGENT_DIR: path.resolve(c.piAgentDir) };
for (const value of Object.values(values)) if (/[\r\n"']/.test(value)) throw new Error('Unsupported deployment path');
const file = path.join(release, 'server/.env');
const original = existsSync(file) ? readFileSync(file, 'utf8') : '';
writeFileSync(file, Object.entries(values).map(([k,v]) => `${k}="${v}"`).join('\n') + '\n' + original, { mode: 0o600 });
NODE
)
# Green's preflight uses scratch state, NEVER the live store or session directory.
mkdir -p "$RELEASE/smoke/root" "$RELEASE/smoke/agent" "$RELEASE/smoke/sessions"
(cd "$RELEASE/server" && exec env HOST=127.0.0.1 PORT=18788 \
  BEEZY_RELEASE="$REF" BEEZY_DRAIN_FILE="$DRAIN" \
  DATA_DIR="$RELEASE/smoke/data" FS_ROOT="$RELEASE/smoke/root" CHAT_FOLDER="$RELEASE/smoke/root/chat" \
  PI_CODING_AGENT_DIR="$RELEASE/smoke/agent" PI_SESSIONS_DIR="$RELEASE/smoke/sessions" \
  ENABLE_DURABLE=false MEMORY_AFTER_DAYS=0 VAULT_URL='' VAULT_TOKEN='' \
  CLOUDFLARE_API_TOKEN='' CLOUDFLARE_ACCOUNT_ID='' node dist/index.js) >"$RELEASE/smoke.log" 2>&1 &
smoke_pid=$!
wait_health http://127.0.0.1:18788/healthz "$REF"
kill "$smoke_pid"; wait "$smoke_pid" || true; smoke_pid=''
# A legacy server has no drain protocol. Never silently kill an active agent to upgrade it.
if ! curl --max-time 3 -fsS "$URL" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const h=JSON.parse(s);process.exit(h.ready && typeof h.busy==="number"?0:1)}catch{process.exit(1)}})' ; then
  if [[ "$BOOTSTRAP" != '--bootstrap' ]]; then
    echo 'Old server lacks safe drain support. After all agents/jobs finish, run npm run deploy -- --bootstrap from an external terminal.' >&2
    exit 1
  fi
  legacy=true
  echo 'BOOTSTRAP: caller has explicitly accepted restarting a legacy server without a drain check.' >&2
else
  touch "$DRAIN"
  # Old releases know this exact marker through their service environment.
  idle=0
  for _ in {1..3600}; do
    health="$(curl --max-time 3 -fsS "$URL")"
    if printf '%s' "$health" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const h=JSON.parse(s);process.exit(h.draining && h.busy===0?0:1)})'; then
      idle=$((idle+1)); if (( idle >= 3 )); then break; fi
    else idle=0; fi
    sleep 1
  done
  (( idle >= 3 )) || { echo 'Drain timed out; leaving old release running.' >&2; exit 1; }
fi
# Single-writer handover. Two live servers must NEVER load/save the shared in-memory db.json.
# Node is already built and tested; only the short stop/start is on the critical path.
cat > "$DROPIN.tmp" <<EOF
[Service]
WorkingDirectory=$RELEASE/server
ExecStart=
ExecStart=/usr/bin/node $RELEASE/server/dist/index.js
Environment=BEEZY_RELEASE=$REF
Environment=BEEZY_DRAIN_FILE=$DRAIN
TimeoutStopSec=60
EOF
switched=true
mv "$DROPIN.tmp" "$DROPIN"
systemctl --user daemon-reload
systemctl --user stop "$SERVICE"
rm -f "$DRAIN"
systemctl --user start "$SERVICE"
wait_health "$URL" "$REF"
success=true
printf '%s\n' "$RELEASE" > "$STATE/current"
echo "Deployed $REF from $RELEASE. Previous release retained for rollback."
