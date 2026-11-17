import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import type { HookRequest } from '../src/types.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Replace the global `fetch` with a mock so replay tests never touch the network. */
function stubFetch(impl: typeof fetch): Mock<typeof fetch> {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** POST a webhook to the capture route and return the stored entry. */
async function capture(
  path: string,
  payload?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<HookRequest> {
  let req = request(app.server).post(path);
  for (const [name, value] of Object.entries(extraHeaders)) {
    req = req.set(name, value);
  }
  const res = payload === undefined ? await req : await req.send(payload);
  expect(res.status).toBe(200);
  return res.body as HookRequest;
}

describe('POST /api/hooks/:id/replay — replay forwarding', () => {
  it('forwards method, query, headers (minus host/content-length) and raw body to the configured target, returning the upstream status', async () => {
    vi.stubEnv('HOOKDOCK_REPLAY_TARGET', 'http://upstream.example:8080');
    const fetchMock = stubFetch(async () => new Response('{"received":true}', { status: 201 }));

    const hook = await capture(
      '/hook/payment?foo=bar&limit=5',
      { event: 'payment' },
      { 'X-Event': 'payment.created' },
    );

    const res = await request(app.server).post(`/api/hooks/${hook.id}/replay`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 201, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.origin).toBe('http://upstream.example:8080');
    expect(url.pathname).toBe('/hook/payment');
    expect(url.searchParams.get('foo')).toBe('bar');
    expect(url.searchParams.get('limit')).toBe('5');

    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBe(JSON.stringify({ event: 'payment' }));
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['x-event']).toBe('payment.created');
    expect(headers['content-type']).toContain('application/json');
    expect(headers.host).toBeUndefined();
    expect(headers['content-length']).toBeUndefined();
  });

  it('falls back to http://localhost:8080 when HOOKDOCK_REPLAY_TARGET is unset', async () => {
    const fetchMock = stubFetch(async () => new Response('ok', { status: 200 }));
    const original = process.env.HOOKDOCK_REPLAY_TARGET;
    delete process.env.HOOKDOCK_REPLAY_TARGET;
    try {
      const hook = await capture('/hook/default-target', { a: 1 });

      const res = await request(app.server).post(`/api/hooks/${hook.id}/replay`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 200, ok: true });
      const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
      const url = new URL(calledUrl);
      expect(url.origin).toBe('http://localhost:8080');
      expect(url.pathname).toBe('/hook/default-target');
    } finally {
      if (original !== undefined) {
        process.env.HOOKDOCK_REPLAY_TARGET = original;
      }
    }
  });

  it('replays a captured GET request without a body', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));

    const captured = await request(app.server).get('/hook/ping?src=hookdock');
    expect(captured.status).toBe(200);
    const hook = captured.body as HookRequest;

    const res = await request(app.server).post(`/api/hooks/${hook.id}/replay`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 204, ok: true });
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(calledUrl).searchParams.get('src')).toBe('hookdock');
    expect(calledInit.method).toBe('GET');
    expect(calledInit.body).toBeUndefined();
  });

  it('responds 404 with error not_found and never calls fetch for an unknown id', async () => {
    const fetchMock = stubFetch(async () => new Response('ok'));

    const res = await request(app.server).post('/api/hooks/no-such-id/replay');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('responds 502 with error replay_failed when the upstream fetch rejects', async () => {
    vi.stubEnv('HOOKDOCK_REPLAY_TARGET', 'http://down.example:9999');
    stubFetch(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const hook = await capture('/hook/failing', { x: 1 });
    const res = await request(app.server).post(`/api/hooks/${hook.id}/replay`);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('replay_failed');
  });
});

describe('DELETE /api/hooks — clear history', () => {
  it('empties the history: GET /api/hooks lists nothing and old ids 404 (detail and replay)', async () => {
    const first = await capture('/hook/clear-a', { n: 1 });
    const second = await capture('/hook/clear-b', { n: 2 });

    const before = await request(app.server).get('/api/hooks');
    expect(before.status).toBe(200);
    const ids = (before.body.hooks as HookRequest[]).map((hook) => hook.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);

    const res = await request(app.server).delete('/api/hooks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: true });

    const after = await request(app.server).get('/api/hooks');
    expect(after.status).toBe(200);
    expect(after.body.hooks).toEqual([]);

    const detail = await request(app.server).get(`/api/hooks/${first.id}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe('not_found');

    const replay = await request(app.server).post(`/api/hooks/${second.id}/replay`);
    expect(replay.status).toBe(404);
    expect(replay.body.error).toBe('not_found');
  });
});
