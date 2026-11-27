# Interactive GitHub Pages demo

The demo runs Beezy's real frontend against an in-memory API, event stream, and browser transport. It opens to a prefilled session; use **Open detailed steps** to inspect `npm test` and its scripted output. It showcases the current UI: markdown tables and charts in replies, the git status indicator, a project-memory pill on the first message, a pending process watch, project memory topics, remote machines, vault secrets, scheduled jobs and applets. It includes fictional accounts, sessions, expandable tool results, scripted chat replies, an interactive browser preview, and illustrative model/host usage. State lives only in React memory and resets on reload. It does not execute commands, connect to models, authenticate accounts, or open a real shared browser.

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

Every push to `main` publishes the demo: `.github/workflows/demo-pages.yml` builds it and force-pushes the contents of `web/dist` (with a `.nojekyll` file) as the single commit of the `gh-pages` branch. Pages serves the branch root at https://pandreew.github.io/pi_group/. The repository's `github-pages` environment only allows the `gh-pages` branch, which is why the workflow pushes there instead of deploying a Pages artifact from `main`. To publish by hand, build as above and push the same contents to `gh-pages`.
