# Interactive GitHub Pages demo

The demo is a static, simulated workspace using Beezy's shared styles and button components. It includes fictional accounts, sessions, expandable tool results, scripted chat replies, an interactive browser preview, and illustrative model/host usage. State lives only in React memory and resets on reload. It does not execute commands, connect to models, authenticate accounts, or open a real shared browser.

## Run locally

```sh
cd web
npm ci
VITE_DEMO=true npm run build -- --base=/pi_group/
npm run preview -- --host 127.0.0.1 --base=/pi_group/
```

Open http://localhost:4173/pi_group/. In another terminal, run `cd web && node test/demo-pages.mjs` to check desktop/mobile interactions and verify that no backend API calls occur. Override `DEMO_URL` if using another port.

Normal builds omit `VITE_DEMO` and continue to start the real app, including its service worker. The demo never registers that service worker.

## Publish

Build as above and publish only the contents of `web/dist` (with a `.nojekyll` file) to the `gh-pages` branch. Pages serves the branch root; changes to `main` require a fresh build and publish.
