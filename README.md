# Echo prototype

Echo by Cognilix: build voice agents, run calling campaigns from a sheet, and get every answer back.
This is a clickable prototype for developers. It matches the local build exactly.

**Live demo:** https://rushilk-moglix.github.io/echo_prototype/ (sign in with any email and password)

## What to look at

- **Agents**: a compact ready to run checklist, prompt, inputs and answers, a simple Voice section (four presets with a price per
  minute; models, backups and turn detection under Details), calling flow, retry rules.
- **Campaigns**: new campaign in one popup (agent, template, sheet), live status by call status, results file
  with every uploaded row back.
- **Call page**: recording, transcript, answers, dial history.
- **Settings**: telephony and calling flows, integrations catalogue with setup checks, calling defaults and
  status rules (No reply is under 5 s of talk, Completed is 5 s or more), data rules.
- **PI Industries agent** (`pi_packaging_followup`): supplier dispatch follow up with several PO rows per call.
  `node mock/e2e-pi.mjs` runs the end to end check against `npm run mock`.

Browser (WebRTC) calls need the real voice backend and are not available in the demo; phone calls are simulated.

## How the demo works

There is no backend. A service worker (`mock/browser/sw.mjs`) runs the local mock (`mock/server.mjs`) inside the
browser and answers every API call under the app's own path (`__mock/...`). All data is invented sample data.

- Data lives in memory. It resets when the browser stops the worker (usually after a few idle minutes) or when you
  clear site data.
- Calls are simulated: dials, ringing, answers, statuses and retries play out over seconds, not real minutes.
- Nothing is dialled and nothing leaves the browser.

## Run locally

```bash
npm ci
npm run start:local      # mock backend + dev server, same data as the demo
npm run build:demo       # the static demo, as deployed (output: dist/frontend/browser)
npm run build:single     # the whole prototype as ONE html file that opens from disk, no server (output: dist/*-Prototype.html)
```

## Design system

Colours, type, components, motion and the checks before merging: `docs/DESIGN-SYSTEM.md`. Paste `docs/ui-audit.js` into the
browser console to check contrast, clipped text and sideways scroll on any page.

## Checks

- `node mock/e2e-pi.mjs` (Echo): PI end to end against `npm run mock`.
- `node mock/e2e-status.mjs` (Echo): Ozonetel to Echo to Clarix status run with scripted Ozonetel results; needs the Echo and Clarix mocks running with
  `ECHO_API_PORT=18090 CLARIX_URL=http://localhost:18081` and `CLARIX_API_PORT=18081 ECHO_URL=http://localhost:18090`.

## Deploy

Every push to `main` runs `.github/workflows/pages.yml`: `npm ci`, `npm run build:demo`, then GitHub Pages.

## Pointing at a real backend

Hosts live in `src/environments/`. The values here are placeholders; set your own before a real build
(`npm run build`). Never commit real keys or tenant ids.
