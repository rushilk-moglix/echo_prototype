# Local mock backend

Runs the live Echo console code unchanged on your machine, with no access to
the real backends, telephony or database.

```
npm ci
npm run start:local        # mock on :8090 and :8080, app on http://localhost:4210
```

Sign in with any email and any password (for example `admin@example.com` /
`local-mock`). Nothing is checked.

## Files

| File | What it does |
| --- | --- |
| `server.mjs` | Serves every endpoint in `src/app/core/endpoints.ts` from memory. Port 8090 stands in for dataload, 8080 for the voice backend. |
| `scenario.json` | Synthetic sample data: 10 agents, 12 campaigns, 93 contacts, 55 calls, 9 Clarix batches. No real people, numbers or emails. The Clarix mock loads the same file, so both products show the same calls. |
| `build-scenario.mjs` | Regenerates `scenario.json` (`npm run mock:scenario`). Seeded, so the output is always the same. |
| `xlsx.mjs` | Tiny .xlsx reader and writer for templates, uploads and reports. |
| `dev.mjs` | Starts the mock and `ng serve` together. |

## Behaviour

- Dates move forward in whole days, so the newest batch is always from the last 24 hours and both mocks show the same times.
- State lives in memory. Restart the mock to reset it.
- Two behaviours, picked with `MOCK_BEHAVIOUR`:
  - `target` (default, for demos): the fixed backend from PRD-ECHO-11. Every
    row gets a final status (completed with a result such as Conversation or
    Hung up early, or No answer, Busy, Unreachable, Invalid number, Failed with
    a reason). Unanswered rows retry up to 3 times, 20 s apart. Campaigns
    finish. Stop works. Every change is posted to the Clarix mock with the full
    status, result, reason, attempt and answers.
  - `live`: today's live behaviour. About half the rows connect; the rest stay
    "dialled" for ever and the campaign stays "running" (finding PF-01), and
    Clarix only hears about connected calls, with two fields.
- Agents: every save pushes the agent to the Clarix mock, which updates that
  agent's setup there (name, voice, fields, answers). The list shows the sync
  state; "Sync now" repeats it.
- Call console, Ozonetel phone channel: dialling plays a scripted conversation
  on the transcript, a turn every 3 seconds, then saves it to the call log.
  No phone is rung.
- Call console, Browser mic channel: not simulated. It needs the real voice
  backend's audio WebSocket.
- Recordings are a few seconds of generated tone, so the player works.
- Settings shows Ozonetel as "not configured", exactly like live, because
  dataload's `/health` has no telephony block.

## Ozonetel results and the PI pilot (30 Sep 2026)

- `ozonetel.mjs`: every dial gets the callback Ozonetel would send (Status, DialStatus, CustomerStatus, HangupBy, ring and talk time) plus what Echo's stream saw, and is mapped to Echo's call status, reason or result by the PRD-ECHO-11 rules. Retries follow section 10 (3 dials; 20 s apart in the demo instead of 60 min). The same file is copied to the Clarix mock, seeded by row id, so both products show the same dials.
- `pi-seed.mjs`: a second workspace, PI Industries (pilot), with its own agent (list answer `lines`), telephony route, buyer logins and a supplier campaign with line results. Sign in as `buyer.one@pi-pilot.example` to see only that workspace.
- New endpoints: `GET /api/campaigns/:id/lines` and `lines.xlsx` (one row per line).
