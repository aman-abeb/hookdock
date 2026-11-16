import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The subset of package.json fields this test asserts on. */
interface PackageJson {
  name: string;
  type: string;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageJson;

/** Absolute path of the compiled CLI entrypoint declared in `bin.hookdock`. */
function binPath(): string {
  const target = pkg.bin?.hookdock;
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error('package.json must declare "bin": { "hookdock": "dist/index.js" }');
  }
  return fileURLToPath(new URL(`../${target}`, import.meta.url));
}

/** Run a command to completion; rejects on non-zero exit, so resolving implies exit code 0. */
function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`\`${command} ${args.join(' ')}\` exited with code ${String(error.code)}: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

describe('package.json — installable `hookdock` bin', () => {
  it('maps the hookdock command to the compiled entrypoint', () => {
    expect(pkg.bin).toEqual({ hookdock: 'dist/index.js' });
  });

  it('ships the compiled dist/ folder via the files allowlist', () => {
    expect(pkg.files).toContain('dist');
  });

  it('keeps the ESM metadata and lifecycle scripts of the package', () => {
    expect(pkg.name).toBe('hookdock');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts?.build).toBe('tsc');
    expect(pkg.scripts?.start).toBe('node dist/index.js');
    expect(pkg.scripts?.test).toBe('vitest run');
    // `prepare` builds dist/ before `npm pack` / `npm install -g .` links the bin
    expect(pkg.scripts?.prepare).toBe('npm run build');
  });

  it('keeps the node shebang in src/index.ts so the emitted bin stays executable', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});

describe('compiled bin target (built by the pretest script)', () => {
  it('exists on disk at the declared bin path', () => {
    expect(existsSync(binPath())).toBe(true);
  });

  it('preserves the shebang in dist/index.js', () => {
    const compiled = readFileSync(binPath(), 'utf8');
    expect(compiled.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('runs standalone with --help and exits 0', { timeout: 20_000 }, async () => {
    const { stdout } = await run(process.execPath, [binPath(), '--help'], projectRoot);
    expect(stdout).toContain('Usage: hookdock');
  });

  it('is included in the tarball a global install would unpack (npm pack --dry-run)', { timeout: 60_000 }, async () => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const { stdout, stderr } = await run(npm, ['pack', '--dry-run', '--ignore-scripts'], projectRoot);
    expect(`${stdout}\n${stderr}`).toContain('dist/index.js');
  });
});
