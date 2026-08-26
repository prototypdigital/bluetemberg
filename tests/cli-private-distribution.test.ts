/**
 * Private pack distribution, end to end through the real CLI.
 *
 * The unit tests one layer down pin that `add`/`install`/`update` forward the escape
 * hatches to the installer. They cannot catch the failure that made those options
 * unusable in the first place: `bin/cli.js` not passing them at all. Only spawning the
 * binary covers that boundary, so this exercises the whole chain — Commander flag →
 * option → installer → extracted files — against a token-gated, unsigned registry.
 *
 * Skipped when `dist/` is absent, since the CLI loads the built output (CI builds first).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { create } from 'tar';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliJs = join(repoRoot, 'bin', 'cli.js');
const distRegistry = join(repoRoot, 'dist', 'registry', 'index.js');

const PACK = 'private-pack';
const TOKEN = 'registry-token-do-not-leak';

const cliSuite = existsSync(distRegistry) ? describe : describe.skip;

function createTmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Every file under `dir`, recursively, as absolute paths. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

cliSuite('cli private pack distribution', () => {
  let server: Server;
  let registryUrl: string;
  let tarball: string;
  let integrity: string;
  let root: string;

  beforeAll(async () => {
    // An npm-shaped pack tarball: everything under a single `package/` wrapper.
    const fixture = createTmpDir('bt-private-pack');
    mkdirSync(join(fixture, 'package', 'rules'), { recursive: true });
    writeFileSync(
      join(fixture, 'package', 'bluetemberg-pack.json'),
      JSON.stringify({ name: PACK, version: '1.0.0', rules: ['rules/internal.md'] }),
    );
    writeFileSync(
      join(fixture, 'package', 'rules', 'internal.md'),
      '---\ndescription: Internal\nscope: "**"\n---\n\n# Internal\n',
    );
    tarball = join(createTmpDir('bt-private-tgz'), `${PACK}-1.0.0.tgz`);
    await create({ file: tarball, cwd: fixture, gzip: true }, ['package']);
    integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;

    // A registry that demands a credential and, like most self-hosted ones, signs nothing.
    server = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.url === `/${PACK}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            name: PACK,
            'dist-tags': { latest: '1.0.0' },
            versions: {
              '1.0.0': {
                name: PACK,
                version: '1.0.0',
                dist: { tarball: `${registryUrl}/${PACK}/-/${PACK}-1.0.0.tgz`, integrity, shasum: 'x' },
              },
            },
          }),
        );
        return;
      }
      if (req.url?.endsWith('.tgz')) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(readFileSync(tarball));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    registryUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    root = createTmpDir('bt-private-project');
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm' }),
    );
    writeFileSync(
      join(root, 'llm', 'packages.json'),
      JSON.stringify({ registry: registryUrl, packages: { [PACK]: '^1.0.0' } }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Run the CLI with a home dir that has no `.npmrc`, so only the project's counts.
   *
   * Async on purpose: the fixture registry runs on this worker's event loop, so a
   * blocking `spawnSync` would deadlock against the request it is waiting for.
   */
  function run(args: string[]): Promise<{ status: number | null; output: string }> {
    const child = spawn(process.execPath, [cliJs, ...args], {
      cwd: root,
      env: { ...process.env, NPM_CONFIG_USERCONFIG: join(root, 'absent.npmrc') },
    });

    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));

    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, output }));
    });
  }

  function writeProjectNpmrc(): void {
    const host = new URL(registryUrl).host;
    writeFileSync(join(root, '.npmrc'), `//${host}/:_authToken=\${PACK_TOKEN}\n`);
  }

  it('fails with actionable guidance when no credential is configured', async () => {
    const r = await run(['install']);

    expect(r.status).toBe(1);
    expect(r.output).toMatch(/denied access to "private-pack" \(HTTP 401\)/);
    expect(r.output).toMatch(/_authToken/);
  });

  it('refuses an unsigned pack without the explicit opt-in', async () => {
    writeProjectNpmrc();
    process.env.PACK_TOKEN = TOKEN;

    const r = await run(['install']);

    expect(r.status).toBe(1);
    expect(r.output).toMatch(/has no registry signature/);
    expect(r.output).toMatch(/--skip-signature-verification/);
    delete process.env.PACK_TOKEN;
  });

  it('installs with --skip-signature-verification and leaks the token nowhere', async () => {
    writeProjectNpmrc();
    process.env.PACK_TOKEN = TOKEN;

    const r = await run(['install', '--skip-signature-verification']);

    expect(r.status).toBe(0);
    expect(existsSync(join(root, '.bluetemberg', 'packs', PACK, '1.0.0', 'bluetemberg-pack.json'))).toBe(
      true,
    );

    // No fabricated signature: `verify` must still be able to call this unsigned.
    const lock = JSON.parse(readFileSync(join(root, 'llm', 'packages-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity?: string; keyid?: string }>;
    };
    expect(lock.packages[PACK].integrity).toBe(integrity);
    expect(lock.packages[PACK].keyid).toBeUndefined();

    // The token reached the registry over the wire and stopped there. Not even the
    // `.npmrc` holds it — it is referenced there as `${PACK_TOKEN}`.
    const leaked = walk(root).filter((file) => readFileSync(file, 'utf8').includes(TOKEN));
    expect(leaked).toEqual([]);
    expect(r.output).not.toContain(TOKEN);
    delete process.env.PACK_TOKEN;
  });

  it('exposes the escape hatches on add, install and update alike', async () => {
    for (const command of ['add', 'install', 'update']) {
      const { output } = await run([command, '--help']);
      expect(output, command).toContain('--skip-signature-verification');
      expect(output, command).toContain('--allow-external-tarball-host');
    }
  });
});
