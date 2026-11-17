# HookDock

<!-- builder:badges:start -->
[![CI](https://github.com/aman-abeb/hookdock/actions/workflows/ci.yml/badge.svg)](https://github.com/aman-abeb/hookdock/actions/workflows/ci.yml) ![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white) ![Node.js](https://img.shields.io/badge/node.js-20%2B-5FA04E?logo=nodedotjs&logoColor=white) ![Fastify](https://img.shields.io/badge/fastify-000000?logo=fastify&logoColor=white) ![License: MIT](https://img.shields.io/badge/license-MIT-green)
<!-- builder:badges:end -->

Local webhook capture, inspection and replay server — debug incoming webhooks without tunnels, mocks, or external services.

## Features

- **Capture** any request sent to `/hook/:name` (GET/POST/PUT/PATCH/DELETE) — method, path, query string, headers and the raw body are stored verbatim
- **In-memory ring buffer** keeps the last 200 requests; older ones are evicted automatically so memory stays bounded
- **Typed JSON read API**: `GET /api/hooks` (list, newest first) and `GET /api/hooks/:id` (single entry, 404 when unknown)
- **Replay**: `POST /api/hooks/:id/replay` forwards a stored request to `$HOOKDOCK_REPLAY_TARGET` (default `http://localhost:8080`) and returns the upstream `{ status, ok }`
- **Clear history**: `DELETE /api/hooks` empties the buffer in one call
- **Zero-build dashboard** at `/` — vanilla JS polling `/api/hooks`, expandable pretty-printed JSON body and headers, per-row **Replay** and **Delete** buttons
- **Local-only by default**: the server binds to `127.0.0.1`
- **Installable CLI**: `npm install -g .` puts a `hookdock` command on your PATH

## Quickstart

```bash
npm install
npm run build
npm start        # serves http://127.0.0.1:3000 — dashboard at /
```

Install the CLI globally so the `hookdock` command is available on your PATH:

```bash
npm install -g .      # the "prepare" script builds dist/ before the bin is linked
hookdock              # http://127.0.0.1:3000
hookdock --port 4000  # custom port
```

Or run the bin straight from a checkout without installing it globally:

```bash
npx . --port 4000           # locally; once published to the npm registry: npx hookdock --port 4000
node dist/index.js --port 4000
```

Development (compile, then restart on change):

```bash
npm run dev
```

## CLI usage

```text
Usage: hookdock [--port <n>]

Options:
  --port <n>   Port to listen on, 1..65535 (default: $PORT, then 3000)
  -h, --help   Show this help and exit
```

The server always binds to `127.0.0.1` — it is meant for local debugging only, never expose it publicly.

## Dashboard walkthrough (curl → browser)

1. Start HookDock and open the dashboard in a browser:

   ```bash
   npm start
   # open http://127.0.0.1:3000/
   ```

2. In another terminal, fire a webhook at it:

   ```bash
   curl -X POST http://127.0.0.1:3000/hook/test \
     -H 'Content-Type: application/json' \
     -H 'X-Event: payment.created' \
     -d '{"event":"payment","amount":4900}'
   ```

3. Within a couple of seconds the request shows up at the top of the list — no manual refresh, the page polls `GET /api/hooks` on a timer. Click a row to expand its pretty-printed JSON body, headers and query string. The row's **Replay** button re-sends the request to your replay target, **Delete** drops that single entry, and **Clear history** (top right) wipes everything via `DELETE /api/hooks`.

Dashboard layout:

```text
 HookDock                                             [Clear history]
 ─────────────────────────────────────────────────────────────────────
 POST  /hook/test          2025-06-01T12:00:00.000Z    [Replay] [Delete]
   ▼ body · application/json
     {
       "event": "payment",
       "amount": 4900
     }
   ▼ headers
     content-type:   application/json
     x-event:        payment.created
     content-length: 33
 GET   /hook/ping?src=demo 2025-06-01T12:00:03.512Z    [Replay] [Delete]
```

## Example

Capture a webhook:

```bash
curl -s -X POST http://127.0.0.1:3000/hook/test \
  -H 'Content-Type: application/json' \
  -d '{"event":"payment"}'
```

```json
{
  "id": "0f7c9b2e-6d1a-4c3b-9e5f-2a8b7c6d5e4f",
  "name": "test",
  "method": "POST",
  "path": "/hook/test",
  "query": {},
  "headers": {
    "host": "127.0.0.1:3000",
    "content-type": "application/json",
    "content-length": "19"
  },
  "rawBody": "{\"event\":\"payment\"}",
  "body": { "event": "payment" },
  "contentType": "application/json",
  "receivedAt": "2025-06-01T12:00:00.000Z"
}
```

Read it back:

```bash
curl -s http://127.0.0.1:3000/api/hooks        # list, newest first
curl -s http://127.0.0.1:3000/api/hooks/<id>   # single entry
```

## Replaying a captured request

Point HookDock at the service you want to replay into (any local HTTP server works; the default is `http://localhost:8080`):

```bash
HOOKDOCK_REPLAY_TARGET=http://127.0.0.1:8080 npm start
```

Capture a webhook, grab its id, then replay it:

```bash
ID=$(curl -s -X POST http://127.0.0.1:3000/hook/test \
  -H 'Content-Type: application/json' \
  -d '{"event":"payment"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")

curl -s -X POST http://127.0.0.1:3000/api/hooks/$ID/replay
```

```json
{ "status": 200, "ok": true }
```

The replay re-sends the stored method, path, query string, headers and raw body to `$HOOKDOCK_REPLAY_TARGET` + the captured path. `host` and `content-length` are never forwarded (`fetch` recomputes them), and GET/HEAD requests are replayed without a body. An unknown id returns `404 { "error": "not_found" }`; an unreachable upstream returns `502 { "error": "replay_failed" }`.

## Clearing the history

```bash
curl -s -X DELETE http://127.0.0.1:3000/api/hooks
```

```json
{ "cleared": true }
```

Afterwards `GET /api/hooks` returns `{ "hooks": [] }` and every previously stored id responds 404.

## API reference

| Method | Path | Description |
| --- | --- | --- |
| `GET`, `POST`, `PUT`, `PATCH`, `DELETE` | `/hook/:name` | Capture a request; responds 200 with the stored entry |
| `GET` | `/` | Dashboard (zero-build single-page app) |
| `GET` | `/api/hooks` | List captured requests, newest first: `{ hooks: [...] }` |
| `GET` | `/api/hooks/:id` | One entry, or `404 { "error": "not_found" }` |
| `POST` | `/api/hooks/:id/replay` | Forward the stored request to the replay target; returns `{ status, ok }`, `404`, or `502 { "error": "replay_failed" }` |
| `DELETE` | `/api/hooks` | Clear the whole history: `{ cleared: true }` |

## How it works

- `src/server.ts` — `createServer()` Fastify factory. A catch-all `parseAs: 'buffer'` content-type parser stores every payload verbatim; JSON bodies are additionally parsed into `body`. It also wires the replay route (global `fetch` against `$HOOKDOCK_REPLAY_TARGET`), `DELETE /api/hooks`, and serves the dashboard from `public/` at `/` via `@fastify/static`.
- `src/store.ts` — `HookStore`, the ring buffer (default capacity 200, oldest evicted first). IDs are UUIDs, timestamps ISO-8601.
- `src/types.ts` — the `HookRequest` shape shared by storage and the JSON API.
- `public/index.html` — the zero-build dashboard: vanilla JS polling `GET /api/hooks`, expandable pretty-printed JSON bodies and headers, per-row Replay (`POST /api/hooks/:id/replay`) and Delete buttons, plus Clear history (`DELETE /api/hooks`).
- `src/index.ts` — CLI entrypoint (`hookdock --port 3000`). It starts with `#!/usr/bin/env node`, which `tsc` preserves in `dist/index.js`; `package.json` maps the command via `"bin": { "hookdock": "dist/index.js" }` and ships the build via `"files": ["dist"]`, so `npm install -g .` links an executable `hookdock` onto your PATH. The app factory is exported separately from `listen()` so tests can drive it with supertest on an ephemeral port.

## Running tests

```bash
npm test          # vitest run — capture, list, detail, 404, content-type handling, ring-buffer eviction, replay forwarding (mocked fetch), clear-history, dashboard asset serving, CLI smoke test, bin packaging
npm run lint
npm run typecheck
npm run build
```

<!-- builder:roadmap:start -->
## Status

**Complete.** HookDock is a finished local webhook capture, inspection and replay server with a zero-build dashboard served from Fastify. It stores the last 200 requests in memory, exposes a typed JSON API for listing/detail/replay/clear, and ships with a polling dashboard featuring expandable headers, pretty-printed bodies, and per-row Replay/Delete controls. All 28 tests pass and the project is ready to ship.

## Roadmap

- [x] **Capture core + typed JSON API**: Fastify factory with POST /hook/:name capturing method, headers, query and raw body into an in-memory ring buffer (last 200 requests). Read API at GET /api/hooks and GET /api/hooks/:id. CLI bin (hookdock --port 3000) that starts the server bound to 127.0.0.1. Vitest + supertest tests for capture, listing, detail, 404 and content-type handling. Runnable: npm test green and a curl POST returns 200 with a stored id.
- [x] **Dashboard UI + replay forwarding**: Serve a zero-build single-page dashboard from / via @fastify/static (vanilla JS polling /api/hooks) showing a request list with timestamps, expandable pretty-printed JSON body and headers, and per-row Replay + Delete buttons. POST /api/hooks/:id/replay forwards the stored request to a target URL (env HOOKDOCK_REPLAY_TARGET, default http://localhost:8080) using global fetch and returns upstream status; DELETE /api/hooks clears history. Tests for replay forwarding (mocked fetch) and static asset serving. README with curl-to-dashboard demo and screenshot.

## Ideas for future work

- Replace polling with WebSocket/SSE for real-time dashboard updates
- Add request filtering, search and tagging in the dashboard
- Support exporting/importing captured request history as JSON
- Add optional request diffing between replay attempts
<!-- builder:roadmap:end -->
