import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { HookStore, MAX_STORED_HOOKS, type NewHookRequest } from '../src/store.js';
import type { HookRequest } from '../src/types.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /hook/:name — capture', () => {
  it('stores a JSON webhook and responds 200 with the stored id', async () => {
    const payload = { event: 'payment' };
    const res = await request(app.server)
      .post('/hook/test')
      .set('X-Event', 'payment.created')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.name).toBe('test');
    expect(res.body.method).toBe('POST');
    expect(res.body.path).toBe('/hook/test');
    expect(res.body.body).toEqual(payload);
    expect(res.body.rawBody).toBe(JSON.stringify(payload));
    expect(res.body.headers['x-event']).toBe('payment.created');
    expect(res.body.contentType).toContain('application/json');
    expect(res.body.receivedAt).toEqual(expect.any(String));
  });

  it('parses JSON bodies that carry a charset parameter', async () => {
    const res = await request(app.server)
      .post('/hook/charset')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ ok: true }));

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ ok: true });
  });

  it('keeps non-JSON bodies raw and leaves body undefined', async () => {
    const res = await request(app.server)
      .post('/hook/plain')
      .set('Content-Type', 'text/plain')
      .send('hello webhook');

    expect(res.status).toBe(200);
    expect(res.body.rawBody).toBe('hello webhook');
    expect(res.body.body).toBeUndefined();
  });

  it('captures the query string', async () => {
    const res = await request(app.server).post('/hook/search?foo=bar&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ foo: 'bar', limit: '5' });
  });

  it('captures requests with an empty body', async () => {
    const res = await request(app.server).post('/hook/empty');

    expect(res.status).toBe(200);
    expect(res.body.rawBody).toBe('');
    expect(res.body.body).toBeUndefined();
  });

  it('captures non-POST methods as well', async () => {
    const res = await request(app.server).put('/hook/put-hook').send({ a: 1 });

    expect(res.status).toBe(200);
    expect(res.body.method).toBe('PUT');
    expect(res.body.body).toEqual({ a: 1 });
  });
});

describe('GET /api/hooks — list', () => {
  it('returns captured hooks newest first', async () => {
    const first = await request(app.server).post('/hook/order-a').send({ n: 1 });
    const second = await request(app.server).post('/hook/order-b').send({ n: 2 });

    const res = await request(app.server).get('/api/hooks');

    expect(res.status).toBe(200);
    const hooks = res.body.hooks as HookRequest[];
    expect(Array.isArray(hooks)).toBe(true);
    const ids = hooks.map((hook) => hook.id);
    expect(ids).toContain(first.body.id);
    expect(ids).toContain(second.body.id);
    expect(ids.indexOf(second.body.id)).toBeLessThan(ids.indexOf(first.body.id));
  });
});

describe('GET /api/hooks/:id — detail', () => {
  it('returns a single captured hook by id', async () => {
    const created = await request(app.server).post('/hook/detail').send({ hello: 'world' });

    const res = await request(app.server).get(`/api/hooks/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.name).toBe('detail');
    expect(res.body.body).toEqual({ hello: 'world' });
    expect(res.body.rawBody).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('responds 404 for an unknown id', async () => {
    const res = await request(app.server).get('/api/hooks/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('responds 404 for unknown API routes', async () => {
    const res = await request(app.server).get('/api/unknown');

    expect(res.status).toBe(404);
  });
});

describe('ring buffer storage', () => {
  const sample = (name: string): NewHookRequest => ({
    name,
    method: 'POST',
    path: `/hook/${name}`,
    query: {},
    headers: {},
    rawBody: '',
    body: undefined,
    contentType: undefined,
  });

  it('evicts the oldest entries beyond the default capacity', () => {
    const store = new HookStore();
    for (let i = 0; i < MAX_STORED_HOOKS + 25; i += 1) {
      store.add(sample(`hook-${i}`));
    }

    expect(store.size).toBe(MAX_STORED_HOOKS);
    const names = store.list().map((hook) => hook.name);
    expect(names[0]).toBe(`hook-${MAX_STORED_HOOKS + 24}`);
    expect(names).not.toContain('hook-0');
  });

  it('caps history end-to-end at the configured capacity', async () => {
    const small = await createServer({ store: new HookStore(3) });
    await small.ready();

    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request(small.server).post('/hook/cap').send({ i });
      expect(res.status).toBe(200);
      ids.push(res.body.id as string);
    }

    const list = await request(small.server).get('/api/hooks');
    expect(list.status).toBe(200);
    const listed = (list.body.hooks as HookRequest[]).map((hook) => hook.id);
    expect(listed).toEqual([ids[4], ids[3], ids[2]]);

    const evicted = await request(small.server).get(`/api/hooks/${ids[0]}`);
    expect(evicted.status).toBe(404);

    await small.close();
  });
});
