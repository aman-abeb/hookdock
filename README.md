# HookDock

<!-- builder:badges:start -->
[![CI](https://github.com/aman-abeb/hookdock/actions/workflows/ci.yml/badge.svg)](https://github.com/aman-abeb/hookdock/actions/workflows/ci.yml) ![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white) ![Node.js](https://img.shields.io/badge/node.js-20%2B-5FA04E?logo=nodedotjs&logoColor=white) ![Fastify](https://img.shields.io/badge/fastify-000000?logo=fastify&logoColor=white) ![License: MIT](https://img.shields.io/badge/license-MIT-green)
<!-- builder:badges:end -->


Local webhook capture, inspection and replay server — debug incoming webhooks without tunnels, mocks, or external services.

## Features

- **Capture** any request sent to `/hook/:name` (GET/POST/PUT/PATCH/DELETE) — method, path, query string, headers and the raw body are stored verbatim
- **In-memory ring buffer** keeps the last 200 requests; older ones are evicted automatically so memory stays bounded
- **Typed JSON read API**: `GET /api/hooks` (list, newest first) and `GET /api/hooks/:id` (single entry, 404 when unknown)
- **Local-only by default**: the server binds to `127.0.0.1`
- Dashboard UI and replay forwarding are planned for the next iteration

## Quickstart

```bash
npm install
npm run build
npm start        # serves http://127.0.0.1:3000
```

Development (compile, then restart on change):

```bash
npm run dev
```

Run the CLI with a custom port:

```bash
node dist/index.js --port 4000
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

## How it works

- `src/server.ts` — `createServer()` Fastify factory. A catch-all `parseAs: 'buffer'` content-type parser stores every payload verbatim; JSON bodies are additionally parsed into `body`.
- `src/store.ts` — `HookStore`, the ring buffer (default capacity 200, oldest evicted first). IDs are UUIDs, timestamps ISO-8601.
- `src/types.ts` — the `HookRequest` shape shared by storage and the JSON API.
- `src/index.ts` — CLI entrypoint (`hookdock --port 3000`), binds `127.0.0.1` and calls `listen()`; the app factory is exported separately from `listen()` so tests can drive it with supertest on an ephemeral port.

## Running tests

```bash
npm test      # vitest run — capture, list, detail, 404, content-type handling, ring-buffer eviction
npm run lint
```

<!-- builder:roadmap:start -->
## Status

**In active development:** 0 of 2 milestones done.

## Roadmap

- [ ] **Capture core + typed JSON API**: Fastify factory with POST /hook/:name capturing method, headers, query and raw body into an in-memory ring buffer (last 200 requests). Read API at GET /api/hooks and GET /api/hooks/:id. CLI bin (hookdock --port 3000) that starts the server bound to 127.0.0.1. Vitest + supertest tests for capture, listing, detail, 404 and content-type handling. Runnable: npm test green and a curl POST returns 200 with a stored id.
- [ ] **Dashboard UI + replay forwarding**: Serve a zero-build single-page dashboard from / via @fastify/static (vanilla JS polling /api/hooks) showing a request list with timestamps, expandable pretty-printed JSON body and headers, and per-row Replay + Delete buttons. POST /api/hooks/:id/replay forwards the stored request to a target URL (env HOOKDOCK_REPLAY_TARGET, default http://localhost:8080) using global fetch and returns upstream status; DELETE /api/hooks clears history. Tests for replay forwarding (mocked fetch) and static asset serving. README with curl-to-dashboard demo and screenshot.
<!-- builder:roadmap:end -->
