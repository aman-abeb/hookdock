#!/usr/bin/env node
import { createServer } from './server.js';

const DEFAULT_PORT = 3000;
const HOST = '127.0.0.1';

const USAGE = `Usage: hookdock [--port <n>]

Local webhook capture, inspection and replay server. Binds to ${HOST} only.

Options:
  --port <n>   Port to listen on, 1..65535 (default: $PORT, then ${DEFAULT_PORT})
  -h, --help   Show this help and exit
`;

/** Resolve the listen port from `--port <n>` or the `PORT` env var (default 3000). */
function resolvePort(argv: string[]): number {
  const flagIndex = argv.indexOf('--port');
  const raw = flagIndex === -1 ? process.env.PORT : argv[flagIndex + 1];
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`hookdock: invalid port "${raw ?? ''}" — expected an integer in 1..65535`);
    process.exit(1);
  }
  return port;
}

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

const port = resolvePort(args);
const app = await createServer();
await app.listen({ host: HOST, port });

console.log(`hookdock listening on http://${HOST}:${port}`);
console.log(`capture a webhook with: curl -X POST http://${HOST}:${port}/hook/<name> -d '{"event":"payment"}'`);
console.log(`inspect captured requests at: curl http://${HOST}:${port}/api/hooks`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
