import Fastify, { type FastifyInstance } from 'fastify';
import { HookStore, type NewHookRequest } from './store.js';
import type { HookRequest } from './types.js';

/** Options accepted by {@link createServer}. */
export interface CreateServerOptions {
  /** Store to use; a fresh {@link HookStore} (capacity 200) is created when omitted. */
  store?: HookStore;
}

/** HTTP methods accepted on the capture route. */
const CAPTURE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Replay target used when the `HOOKDOCK_REPLAY_TARGET` env var is not set. */
const DEFAULT_REPLAY_TARGET = 'http://localhost:8080';

/**
 * Headers that are never forwarded verbatim on replay: `host` describes the original
 * capture connection and `content-length` is recomputed by `fetch` from the forwarded
 * body, so forwarding either would corrupt the replayed request.
 */
const REPLAY_DROPPED_HEADERS = new Set(['host', 'content-length']);

/** Methods that must not carry a body when replayed (`fetch` rejects a body for them). */
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/**
 * Build the HookDock Fastify app without listening on a port.
 *
 * The returned instance is exported separately from `listen()` so tests can
 * drive it with supertest on an ephemeral port, while the CLI calls `listen()`.
 *
 * Routes:
 * - `GET|POST|PUT|PATCH|DELETE /hook/:name` — capture a request into the store, returns the stored entry (200)
 * - `GET /api/hooks` — list captured requests, newest first: `{ hooks: HookRequest[] }`
 * - `GET /api/hooks/:id` — a single captured request, or 404 `{ error: 'not_found', id }`
 * - `POST /api/hooks/:id/replay` — forward a stored request to the replay target and return the upstream `{ status, ok }`; 404 `{ error: 'not_found', id }` for unknown ids, 502 `{ error: 'replay_failed', id }` when the upstream call fails
 * - `DELETE /api/hooks` — clear the whole history: `{ cleared: true }`
 */
export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? new HookStore();
  const app = Fastify({ logger: false });

  // Capture every payload as a raw buffer so nothing is lost before storage;
  // the built-in JSON/text parsers are overridden explicitly for determinism.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(['application/json', 'text/plain'], { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.route<{ Params: { name: string } }>({
    method: [...CAPTURE_METHODS],
    url: '/hook/:name',
    handler: (request) => {
      const rawBody = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
      const contentType = request.headers['content-type'];
      const input: NewHookRequest = {
        name: request.params.name,
        method: request.method,
        path: (request.raw.url ?? '/').split('?')[0],
        query: request.query as Record<string, unknown>,
        headers: request.headers,
        rawBody,
        body: parseJsonBody(rawBody, contentType),
        contentType,
      };
      return store.add(input);
    },
  });

  app.get('/api/hooks', async () => ({ hooks: store.list() }));

  app.get<{ Params: { id: string } }>('/api/hooks/:id', async (request, reply) => {
    const hook = store.get(request.params.id);
    if (!hook) {
      return reply.code(404).send({ error: 'not_found', id: request.params.id });
    }
    return hook;
  });

  app.post<{ Params: { id: string } }>('/api/hooks/:id/replay', async (request, reply) => {
    const hook = store.get(request.params.id);
    if (!hook) {
      return reply.code(404).send({ error: 'not_found', id: request.params.id });
    }
    const url = `${replayTarget()}${hook.path}${serializeQuery(hook.query)}`;
    try {
      const upstream = await fetch(url, {
        method: hook.method,
        headers: replayHeaders(hook.headers),
        body: BODYLESS_METHODS.has(hook.method) || hook.rawBody.length === 0 ? undefined : hook.rawBody,
      });
      return { status: upstream.status, ok: upstream.ok };
    } catch {
      return reply.code(502).send({ error: 'replay_failed', id: hook.id });
    }
  });

  app.delete('/api/hooks', async () => {
    store.clear();
    return { cleared: true };
  });

  return app;
}

/** Parse `rawBody` as JSON when the content type says JSON; `undefined` otherwise. */
function parseJsonBody(rawBody: string, contentType: string | undefined): unknown {
  if (rawBody.length === 0 || !contentType?.toLowerCase().includes('json')) {
    return undefined;
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

/** Base URL replays are forwarded to: `$HOOKDOCK_REPLAY_TARGET`, default `http://localhost:8080`, trailing slashes trimmed. */
function replayTarget(): string {
  return (process.env.HOOKDOCK_REPLAY_TARGET ?? DEFAULT_REPLAY_TARGET).replace(/\/+$/, '');
}

/** Re-serialize a stored query object into a `?a=1&b=2` suffix, or `''` when it is empty. */
function serializeQuery(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
    } else {
      params.append(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

/** Copy the stored headers for forwarding, dropping the ones in {@link REPLAY_DROPPED_HEADERS}. */
function replayHeaders(headers: HookRequest['headers']): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (REPLAY_DROPPED_HEADERS.has(name) || value === undefined) {
      continue;
    }
    forwarded[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return forwarded;
}
