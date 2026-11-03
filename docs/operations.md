# Running and maintaining Beezy

## Service and HTTPS

For a persistent service, adapt [`deploy/pi-group.service`](../deploy/pi-group.service) to your checkout and OS user. Check its paths and environment before enabling it.

The optional secret vault is a separate service: [`deploy/beezy-vault.service`](../deploy/beezy-vault.service). See [secret vault](vault.md).

Use an HTTPS reverse proxy for remote access. Disable proxy buffering for event streams and set `COOKIE_SECURE=true` over HTTPS.

Android: browser menu → Install app. iPhone: Safari → Share → Add to Home Screen.

## Updating the development machine

Build the checkout and restart the server directly. There is no queued deployment controller, release extraction, drain wait, or automatic rollback.

```bash
npm run build
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
systemctl --user restart pi-group.service
curl --fail http://127.0.0.1:8788/healthz
```

The user service must point at this checkout's `server` working directory and `server/dist/index.js`. Remove obsolete `90-beezy-release.conf` overrides when moving back from an immutable release. A restart interrupts active work; do it when requested or when agents/jobs are idle. Do not run two production backends against the same data.

This machine's Beezy server uses port 8788. Do not restart pi-web on port 8787, the vault, or the Cloudflare tunnel when updating Beezy.

Inspect failures directly:

```bash
systemctl --user status pi-group.service --no-pager
journalctl --user -u pi-group.service -n 80 --no-pager
```

The pinned one-command installer is for a separate new installation, not for updating this checkout. Never overwrite an installation's `.env` or data directory.

## Accounts from the command line

```bash
npm run user -- add alice 'a-long-password'
npm run user -- add bob 'another-password' --admin
npm run user -- list
```

## Development

```bash
npm run setup
npm run dev:server
npm run dev:web
npm test --prefix server
npm test --prefix web
npm test --prefix vault
npm run lint --prefix web
npm run build
```

Browser regression checks use mocked APIs and create no real sessions:

```bash
(cd web && npx playwright install chromium --only-shell)
# With npm run dev:web running:
TEST_URL=http://localhost:5173 npm run test:browser --prefix web
node web/test/folder-composer.mjs
node web/test/readme-screenshots.mjs
```
