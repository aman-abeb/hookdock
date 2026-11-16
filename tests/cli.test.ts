import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createTcpServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HookRequest } from '../src/types.js';

/** Absolute path to the compiled CLI entrypoint (produced by the `pretest` build). */
const CLI_PATH = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

/** Reserve an ephemeral port by binding to port 0 on 127.0.0.1, then release it for the CLI. */
async function reserveFreePort(): Promise<number> {
  const probe: Server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, HOST, () => resolve());
  });
  const address = probe.address();
  if (address === null || typeof address === 'string') {
    throw new Error('could not reserve an ephemeral port');
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

/** Poll `GET /api/hooks` over real HTTP until the spawned CLI answers, or throw after `timeoutMs`. */
async function waitUntilReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/hooks`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`GET /api/hooks answered with status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`CLI at ${baseUrl} was not ready within ${timeoutMs}ms (last error: ${String(lastError)})`);
}

/**
 * End-to-end smoke test: spawn the built CLI (`node dist/index.js --port <ephemeral>`)
 * as a real process bound to 127.0.0.1, then exercise capture and the read APIs over HTTP.
 */
describe('hookdock CLI — real-process smoke test on 127.0.0.1', () => {
  let child!: ChildProcess;
  let baseUrl = '';
  let childOutput = '';

  beforeAll(async () => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `CLI bundle missing at ${CLI_PATH} — run "npm run build" first ("npm test" builds automatically via the pretest script)`,
      );
    }
    const port = await reserveFreePort();
    baseUrl = `http://${HOST}:${port}`;
    child = spawn(process.execPath, [CLI_PATH, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        childOutput += chunk.toString('utf8');
      });
    }
    try {
      await waitUntilReady(baseUrl, STARTUP_TIMEOUT_MS);
    } catch (error) {
      child.kill('SIGKILL');
      throw new Error(
        `hookdock CLI did not start: ${error instanceof Error ? error.message : String(error)}\nCLI output:\n${childOutput}`,
      );
    }
  }, STARTUP_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill('SIGKILL');
    await exited;
  });

  it('captures a POSTed webhook and serves it through the read APIs', { timeout: TEST_TIMEOUT_MS }, async () => {
    const payload = { event: 'payment' };
    const captureResponse = await fetch(`${baseUrl}/hook/smoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(captureResponse.status).toBe(200);
    const stored = (await captureResponse.json()) as HookRequest;
    expect(stored.id).toEqual(expect.any(String));
    expect(stored.name).toBe('smoke');
    expect(stored.method).toBe('POST');
    expect(stored.path).toBe('/hook/smoke');
    expect(stored.body).toEqual(payload);
    expect(stored.rawBody).toBe(JSON.stringify(payload));

    const listResponse = await fetch(`${baseUrl}/api/hooks`);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { hooks: HookRequest[] };
    expect(list.hooks.map((hook) => hook.id)).toContain(stored.id);

    const detailResponse = await fetch(`${baseUrl}/api/hooks/${stored.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as HookRequest;
    expect(detail.id).toBe(stored.id);
    expect(detail.name).toBe('smoke');
    expect(detail.headers['content-type']).toContain('application/json');
    expect(detail.receivedAt).toEqual(expect.any(String));
  });

  it('shuts down cleanly with exit code 0 on SIGTERM', { timeout: TEST_TIMEOUT_MS }, async () => {
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    expect(child.kill('SIGTERM')).toBe(true);
    const { code, signal } = await exited;
    expect(signal).toBeNull();
    expect(code).toBe(0);
  });
});
