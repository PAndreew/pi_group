# Running and maintaining Beezy

## Service and HTTPS

For a persistent service, adapt [`deploy/pi-group.service`](../deploy/pi-group.service) to your checkout and OS user. Check its paths and environment before enabling it.

The optional secret vault is a separate service with its own unit, [`deploy/beezy-vault.service`](../deploy/beezy-vault.service). `npm run deploy` restarts it when it is installed as a user service. See [secret vault](vault.md).

For remote access, use an HTTPS reverse proxy (for example Caddy, nginx or Tailscale Serve). Set `COOKIE_SECURE=true`. Disable proxy buffering for event streams (`proxy_buffering off` in nginx).

Android: browser menu → Install app. iPhone: Safari → Share → Add to Home Screen. On iOS 16.4+, notifications require the installed app. Enable notifications from the user menu over HTTPS.

## Updating the existing development machine

Use **`npm run deploy`** from the existing development checkout. This is its canonical deployment command:

- Requires a clean checkout and verifies the user service belongs to this installation.
- Deploys exactly local `HEAD`; it does **not** pull. Review/merge remote changes first.
- Queues a separate `beezy-deploy-*` **user systemd service**. It survives the agent, chat, and Beezy restarting. The command returning means **queued**, not deployed; follow the printed `journalctl` command.
- Extracts an immutable source release under `~/.local/state/beezy/releases/`, copies runtime `.env` privately, installs locked dependencies and builds away from the live files. Data/session paths are resolved against the original checkout, not the new release directory.
- Runs bounded server deployment tests and web tests, then smoke-tests the candidate on loopback port 18788 with disposable data/session/workspace directories. The optional PTY test is excluded from deployment checks because it currently hangs on this host; run it separately when changing terminals. `npm test --prefix server` remains the complete suite.
- Signals the old server to drain via a local marker. New writes get retryable 503 responses; existing agents, tool bridges and human answers continue. New scheduled jobs and memory runs pause. The controller waits for running agents, queued prompts, jobs, memory runs and in-flight mutations to finish, with three idle checks and a one-hour timeout. A timeout leaves the old version running.
- Changes only its own `90-beezy-release.conf` systemd drop-in, gracefully stops the old writer, starts the new release, then checks `/healthz` on port 8788 for readiness **and the exact commit**. On activation failure it restores the previous drop-in and restarts the old release. Old release directories are retained.

This is **staged blue/green with a single-writer handover**, not zero-downtime blue/green. There is a brief reconnect gap during stop/start; open terminal/browser connections may reconnect. Two active backends must not share `db.json`: each keeps a writable in-memory snapshot, owns its agents and schedules jobs. Seamless migration of running agents requires a separate persistent agent host plus coordinated state/scheduler ownership; a reverse proxy alone cannot provide it. Do not start a second production backend against the same data.

**First upgrade:** the already-running legacy server does not understand draining. Once every agent/job has finished, from an external terminal run `npm run deploy -- --bootstrap`. This explicitly accepts the first restart without a drain check. Never bootstrap during an active run. Future deployments can be requested from Beezy itself; their controller waits until the requesting agent finishes before switching. No production activation was performed merely by editing these files.

This command targets this machine's **user `pi-group.service` on port 8788**, never pi-web on port 8787, the vault, or the Cloudflare tunnel. Other installations must adapt the service/health addresses. Runtime settings should be in the checkout's `.env`/`server/.env` or the existing unit environment. Releases contain private configuration; keep their directory private. Back up data before schema changes: automatic code rollback assumes backward-compatible data and deliberately never overwrites live data with an old snapshot.

Controller regression tests (fake systemd/build/HTTP; no live service changes):

```bash
node --test deploy/release.test.mjs
```

They cover activation, build failure, rollback and refusing an undrainable legacy server. Failed deployment logs and the candidate smoke log remain available for diagnosis. After an unexpected machine/controller crash, remove `~/.local/state/beezy/draining` only after verifying that no deployment controller is still running.

The one-command installer is a separate, pinned installation, not an updater. It checks out a release tag; it does not install or restart a service. Don't run the development deployment command on that detached release checkout. To try a newer release, install it in a new directory with `BEEZY_INSTALL_DIR`, back up and migrate your data/configuration deliberately, and stop the old instance before starting the new one. Never overwrite an installation's `.env` or data directory.

## Accounts from the command line

```bash
npm run user -- add alice 'a-long-password'
npm run user -- add bob 'another-password' --admin
npm run user -- list
```

## Development

```bash
npm run setup
npm run dev:server       # API on :8787
npm run dev:web          # UI on :5173
npm test --prefix server
npm test --prefix web
npm test --prefix vault
npm run lint --prefix web
npm run build
```

Browser regression checks (mock APIs, no real sessions):

```bash
(cd web && npx playwright install chromium --only-shell)
# With npm run dev:web running:
TEST_URL=http://localhost:5173 npm run test:browser --prefix web
node web/test/readme-screenshots.mjs
```

The screenshot script renders two fictional users and scripted agent messages in the real UI. It creates no accounts, sends no prompts and needs no provider credentials.
