# Running and maintaining Beezy

## Service and HTTPS

For a persistent service, adapt [`deploy/pi-group.service`](../deploy/pi-group.service) to your checkout and OS user. Check its paths and environment before enabling it.

The optional secret vault is a separate service with its own unit, [`deploy/beezy-vault.service`](../deploy/beezy-vault.service). `npm run deploy` restarts it when it is installed as a user service. See [secret vault](vault.md).

For remote access, use an HTTPS reverse proxy (for example Caddy, nginx or Tailscale Serve). Set `COOKIE_SECURE=true`. Disable proxy buffering for event streams (`proxy_buffering off` in nginx).

Android: browser menu → Install app. iPhone: Safari → Share → Add to Home Screen. On iOS 16.4+, notifications require the installed app. Enable notifications from the user menu over HTTPS.

## Updating the existing development machine

Use **`npm run deploy`** from the existing development checkout. This is its canonical deployment command:

- Requires a clean checkout and verifies the user service targets this checkout.
- Pulls with `--ff-only`, installs locked dependencies, and builds web + server.
- Restarts only the **user** `pi-group.service` after a successful build.
- Checks service status and HTTP at `http://127.0.0.1:8788/`, reporting the deployed commit.

This is distinct from **pi-web on port 8787**, which this command never restarts.
For another installation, set `DEPLOY_HEALTH_URL` to its actual HTTP address.
A failed build leaves the existing service running; a failed post-restart health check returns an error (there is no automatic rollback).

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
