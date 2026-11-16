import Fastify, { type FastifyInstance } from 'fastify';
import { HookStore, type NewHookRequest } from './store.js';

/** Options accepted by {@link createServer}. */
export interface CreateServerOptions {
  /** Store to use; a fresh {@link HookStore} (capacity 200) is created when omitted. */
  store?: HookStore;
}

/** HTTP methods accepted on the capture route. */
const CAPTURE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

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
