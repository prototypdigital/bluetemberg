import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectStacks, detectStacksFromManifests } from '../src/stacks/detect.js';
import { MAX_LOCKFILE_BYTES, parseLockfile, type LockfileName } from '../src/stacks/lockfile.js';
import { pnpmVersion } from '../src/stacks/lockfile-pnpm.js';
import { builtinStackPackages } from '../src/stacks/packages.js';
import type { DetectedStack } from '../src/stacks/match.js';

/**
 * Lockfile-backed detection (#291). The fixtures under `tests/fixtures/lockfiles/` were written
 * by the package managers themselves (`pnpm install --lockfile-only` with pnpm 7, 8 and 11;
 * `yarn install` with yarn 1.22.22; `yarn install --mode=update-lockfile` with yarn 4.18.1) and
 * are kept byte-for-byte. None has `node_modules`, so every exact version below comes from the
 * lockfile. No test touches the network.
 */

const FIXTURES = join(import.meta.dirname, 'fixtures', 'lockfiles');
const packages = builtinStackPackages();

function fixture(name: string, ...sub: string[]): string {
  return join(FIXTURES, name, ...sub);
}

function detect(root: string, onWarning?: (m: string) => void): Map<string, DetectedStack> {
  return detectStacks(root, undefined, packages, onWarning);
}

/** `stack → version@source` for a compact, readable expectation. */
function summary(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [stack, det] of detect(root)) out[stack] = `${det.version} ${det.confidence} ${det.source}`;
  return out;
}

describe('pnpm-lock.yaml', () => {
  it('v9 workspace: resolves each package from its own importer (catalog:, peers, patches)', () => {
    expect(summary(fixture('pnpm-v9-workspace', 'packages', 'web'))).toEqual({
      // `next` carries a nested peer suffix: 14.2.3(react-dom@18.3.1(react@18.3.1))(react@18.3.1)
      nextjs: '14.2.3 exact ../../pnpm-lock.yaml',
      // `catalog:` specifier — the importer records the catalog's resolved version
      react: '18.3.1 exact ../../pnpm-lock.yaml',
    });
  });

  it('v9 workspace: a second version of the same package resolves per importer', () => {
    expect(summary(fixture('pnpm-v9-workspace', 'packages', 'legacy'))).toEqual({
      react: '17.0.2 exact ../../pnpm-lock.yaml',
      // patchedDependencies: 3.4.21(patch_hash=…)
      vue: '3.4.21 exact ../../pnpm-lock.yaml',
      // same-name alias `npm:solid-js@1.8.17`
      solid: '1.8.17 exact ../../pnpm-lock.yaml',
      // `svelte: npm:preact@10.19.0` is preact, not svelte: never reported as svelte 10.19.0
    });
    expect(summary(fixture('pnpm-v9-workspace', 'packages', 'ui'))).toEqual({
      react: '18.3.1 exact ../../pnpm-lock.yaml',
    });
    expect(summary(fixture('pnpm-v9-workspace'))).toEqual({ tailwind: '3.4.19 exact pnpm-lock.yaml' });
  });

  it('v6 single project: top-level importer fields, same-name alias', () => {
    expect(summary(fixture('pnpm-v6-single'))).toEqual({
      nextjs: '13.4.0 exact pnpm-lock.yaml',
      react: '18.3.1 exact pnpm-lock.yaml',
      vue: '3.3.4 exact pnpm-lock.yaml',
    });
  });

  it('v5.4 workspace: underscore peer suffix and /name/version alias', () => {
    expect(summary(fixture('pnpm-v5-workspace', 'packages', 'web'))).toEqual({
      nextjs: '13.4.0 exact ../../pnpm-lock.yaml',
      react: '18.3.1 exact ../../pnpm-lock.yaml',
    });
  });

  it('pnpm 11: reads the project document after the config-dependency env document', () => {
    expect(summary(fixture('pnpm-v9-env-document'))).toEqual({ react: '18.2.0 exact pnpm-lock.yaml' });
  });

  it('normalises importer versions: suffixes, aliases, links and URLs', () => {
    expect(pnpmVersion('next', '14.2.3(react-dom@18.3.1(react@18.3.1))(react@18.3.1)', 9)).toBe('14.2.3');
    expect(pnpmVersion('vue', '3.4.21(patch_hash=abc)', 9)).toBe('3.4.21');
    expect(pnpmVersion('react', 'react@18.3.1', 9)).toBe('18.3.1');
    expect(pnpmVersion('react', '/react@18.3.1', 6)).toBe('18.3.1');
    expect(pnpmVersion('svelte', 'preact@10.19.0', 9)).toBeNull();
    expect(pnpmVersion('@trpc/server', '@trpc/server@10.45.2', 9)).toBe('10.45.2');
    expect(pnpmVersion('ui', 'link:../ui', 9)).toBeNull();
    expect(pnpmVersion('x', 'file:../x.tgz', 9)).toBeNull();
    expect(pnpmVersion('x', 'https://codeload.github.com/a/x/tar.gz/abc', 9)).toBeNull();
    // 5.x: `_` ends the version only — a name may contain one (string_decoder)
    expect(pnpmVersion('next', '13.4.0_nnrd3gsncyragczmpvfhocinkq', 5)).toBe('13.4.0');
    expect(pnpmVersion('string_decoder', '/string_decoder/1.3.0', 5)).toBe('1.3.0');
    expect(pnpmVersion('svelte', '/preact/10.19.0', 5)).toBeNull();
    expect(pnpmVersion('@scope/a', '/@scope/a/1.0.0_react@18.3.1', 5)).toBe('1.0.0');
  });
});

describe('yarn.lock v1', () => {
  it('resolves each workspace from its own package.json range (multi-spec keys)', () => {
    expect(summary(fixture('yarn-v1-workspace', 'packages', 'web'))).toEqual({
      react: '18.3.1 exact ../../yarn.lock',
      // quoted scoped key `"@trpc/server@10.45.2":`
      trpc: '10.45.2 exact ../../yarn.lock',
    });
  });

  it('a second version of the same package resolves per workspace; resolutions apply', () => {
    expect(summary(fixture('yarn-v1-workspace', 'packages', 'legacy'))).toEqual({
      react: '17.0.2 exact ../../yarn.lock',
      // quoted alias key `"vue@npm:vue@3.4.21":`
      vue: '3.4.21 exact ../../yarn.lock',
    });
    // `react-dom@18.2.0, react-dom@^18.2.0, react-dom@^18.3.0:` — root `resolutions` pinned 18.2.0
    const lock = parseLockfile(
      'yarn.lock',
      readFileSync(fixture('yarn-v1-workspace', 'yarn.lock'), 'utf8'),
    ).lock;
    expect(lock?.versionOf('react-dom', [{ path: 'packages/legacy', range: '^18.3.0' }])).toBe('18.2.0');
    expect(lock?.versionOf('svelte', [{ path: 'packages/web', range: 'npm:preact@10.19.0' }])).toBeNull();
  });
});

describe('yarn.lock berry', () => {
  it('resolves through the workspace entry; aliases to other packages are not reported', () => {
    expect(summary(fixture('yarn-berry-workspace', 'packages', 'web'))).toEqual({
      react: '18.3.1 exact ../../yarn.lock',
    });
  });

  it('applies root resolutions, catalog: from .yarnrc.yml and patch: descriptors', () => {
    expect(summary(fixture('yarn-berry-workspace', 'packages', 'legacy'))).toEqual({
      // resolutions: { "react@npm:^17.0.2": "17.0.1" }
      react: '17.0.1 exact ../../yarn.lock',
      // catalog: → .yarnrc.yml `catalog` → @trpc/server@npm:^10.45.0
      trpc: '10.45.4 exact ../../yarn.lock',
      // patch:solid-js@npm%3A1.8.17#~/patches/solid.patch
      solid: '1.8.17 exact ../../yarn.lock',
      vue: '3.4.21 exact ../../yarn.lock',
    });
  });

  it('a range-specific resolution wins over a name-only one, whatever their order', () => {
    const text = readFileSync(fixture('yarn-berry-workspace', 'yarn.lock'), 'utf8');
    const legacy = [{ path: 'packages/legacy', range: '^17.0.2' }];
    for (const resolutions of [
      { react: '^18.2.0', 'react@npm:^17.0.2': '17.0.1' },
      { 'react@^17.0.2': '17.0.1', react: '^18.2.0' },
    ]) {
      const { lock } = parseLockfile('yarn.lock', text, { rootManifest: { resolutions } });
      expect(lock?.versionOf('react', legacy)).toBe('17.0.1');
      // web's react@npm:^18.2.0 has no specific entry, so the name-only resolution applies
      expect(lock?.versionOf('react', [{ path: 'packages/web', range: '^18.2.0' }])).toBe('18.3.1');
    }
  });

  it('without .yarnrc.yml (remote), catalog: resolves only when the lockfile has one version', () => {
    const text = readFileSync(fixture('yarn-berry-workspace', 'yarn.lock'), 'utf8');
    const lock = parseLockfile('yarn.lock', text).lock;
    expect(lock?.versionOf('@trpc/server', [{ path: 'packages/legacy', range: 'catalog:' }])).toBe('10.45.4');
    // react is locked at 17.0.1 and 18.3.1 — ambiguous, so no answer
    expect(lock?.versionOf('react', [{ path: 'nowhere', range: 'catalog:' }])).toBeNull();
    // a workspace package itself (linkType: soft) is never a version
    expect(lock?.versionOf('legacy', [{ path: 'packages/web', range: 'workspace:^' }])).toBeNull();
  });
});

describe('lockfile fallbacks', () => {
  let root: string;
  beforeEach(() => {
    root = join(tmpdir(), `bt-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function copyFixture(name: string): string {
    cpSync(fixture(name), root, { recursive: true });
    return root;
  }

  function toCrlf(file: string): void {
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  }

  it('installed node_modules still wins over the lockfile', () => {
    copyFixture('pnpm-v6-single');
    mkdirSync(join(root, 'node_modules', 'react'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'react', 'package.json'), '{"version":"18.2.0"}');
    expect(detect(root).get('react')).toEqual({
      version: '18.2.0',
      confidence: 'exact',
      source: 'node_modules',
    });
  });

  it.each([
    ['yarn-v1-workspace', 'yarn.lock'],
    ['yarn-berry-workspace', 'yarn.lock'],
    ['pnpm-v9-workspace', 'pnpm-lock.yaml'],
  ])('CRLF line endings: %s resolves exactly as with LF', (name, file) => {
    const lf = summary(fixture(name, 'packages', 'legacy'));
    copyFixture(name);
    toCrlf(join(root, file));
    expect(summary(join(root, 'packages', 'legacy'))).toEqual(lf);
  });

  it.each<[LockfileName, string]>([
    ['pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies: [unclosed\n"],
    ['yarn.lock', '# yarn lockfile v1\n\n<<<<<<< HEAD\nreact@^18.2.0:\n  version "18.3.1"\n'],
    ['package-lock.json', '{"lockfileVersion": 3, "packages": {'],
  ])('a malformed %s falls back to the range and warns once', (file, text) => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.2.0', next: '^14.1.0' } }),
    );
    writeFileSync(join(root, file), text);
    const warnings: string[] = [];
    const d = detect(root, (w) => warnings.push(w));
    expect(d.get('react')).toEqual({ version: '18.2.0', confidence: 'coerced', source: 'package.json' });
    expect(d.get('nextjs')?.confidence).toBe('coerced');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      new RegExp(`^${file.replace('.', '\\.')} could not be parsed \\(.+\\) — using package.json ranges`),
    );
  });

  it('a lockfile parsed by an earlier call is re-read once it changes, and still warns when broken', () => {
    copyFixture('yarn-v1-workspace');
    const web = join(root, 'packages', 'web');
    expect(detect(web).get('react')?.version).toBe('18.3.1');
    const lockPath = join(root, 'yarn.lock');
    writeFileSync(
      lockPath,
      `${readFileSync(lockPath, 'utf8').replace('version "18.3.1"', 'version "18.2.0"')}\n# edited\n`,
    );
    expect(detect(web).get('react')?.version).toBe('18.2.0');

    writeFileSync(lockPath, '# yarn lockfile v1\n\n<<<<<<< HEAD\n');
    for (let call = 0; call < 2; call++) {
      const warnings: string[] = [];
      expect(detect(web, (w) => warnings.push(w)).get('react')?.confidence).toBe('coerced');
      expect(warnings).toEqual([expect.stringMatching(/^\.\.\/\.\.\/yarn\.lock could not be parsed/)]);
    }
  });

  it('an unrecognised yarn.lock is reported, not guessed at', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^18.2.0' } }));
    writeFileSync(join(root, 'yarn.lock'), 'react@^18.2.0:\n  version "18.3.1"\n');
    const warnings: string[] = [];
    expect(detect(root, (w) => warnings.push(w)).get('react')?.confidence).toBe('coerced');
    expect(warnings).toEqual([
      'yarn.lock unrecognised format — using package.json ranges for stack versions',
    ]);
  });

  it('an oversized lockfile is skipped without being read', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^18.2.0' } }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    truncateSync(join(root, 'pnpm-lock.yaml'), MAX_LOCKFILE_BYTES + 1); // sparse: no real I/O
    const warnings: string[] = [];
    expect(detect(root, (w) => warnings.push(w)).get('react')?.confidence).toBe('coerced');
    expect(warnings[0]).toMatch(/^pnpm-lock\.yaml too large to read \(64\.0 MiB, limit 64\.0 MiB\)/);
  });

  it('a stale lockfile that lacks the dependency falls back to the range silently', () => {
    copyFixture('pnpm-v6-single');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { svelte: '^4.2.0' } }));
    const warnings: string[] = [];
    expect(detect(root, (w) => warnings.push(w)).get('svelte')).toEqual({
      version: '4.2.0',
      confidence: 'coerced',
      source: 'package.json',
    });
    expect(warnings).toEqual([]);
  });

  it('never coerces an alias to another package into this stack', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { svelte: 'npm:preact@10.19.0' } }),
    );
    expect(detect(root).has('svelte')).toBe(false);
  });
});

describe('remote (detectStacksFromManifests + parseLockfile)', () => {
  it.each<[string, LockfileName]>([
    ['pnpm-v6-single', 'pnpm-lock.yaml'],
    ['pnpm-v9-env-document', 'pnpm-lock.yaml'],
  ])('%s: the remote path agrees with local detection', (name, file) => {
    const manifest = JSON.parse(readFileSync(fixture(name, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const parsed = parseLockfile(file, readFileSync(fixture(name, file), 'utf8'), { rootManifest: manifest });
    expect(parsed.error).toBeUndefined();
    const remote = detectStacksFromManifests(manifest, parsed.lock, undefined, packages);
    expect(remote).toEqual(detect(fixture(name)));
  });

  it('yarn berry root importer: resolves through the root workspace entry', () => {
    const manifest = JSON.parse(
      readFileSync(fixture('yarn-berry-workspace', 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const text = readFileSync(fixture('yarn-berry-workspace', 'yarn.lock'), 'utf8');
    const { lock } = parseLockfile('yarn.lock', text, { rootManifest: manifest });
    expect(detectStacksFromManifests(manifest, lock, undefined, packages).get('tailwind')).toEqual({
      version: '3.4.19',
      confidence: 'exact',
      source: 'yarn.lock',
    });
  });

  it('still accepts a plain package-lock.json object', () => {
    const lock = { lockfileVersion: 3, packages: { 'node_modules/next': { version: '15.3.1' } } };
    expect(
      detectStacksFromManifests({ dependencies: { next: '^15.0.0' } }, lock).get('nextjs')?.version,
    ).toBe('15.3.1');
  });

  it('strips a byte-order mark', () => {
    const text = `﻿${readFileSync(fixture('pnpm-v6-single', 'pnpm-lock.yaml'), 'utf8')}`;
    expect(
      parseLockfile('pnpm-lock.yaml', text).lock?.versionOf('react', [{ path: '', range: '^18.2.0' }]),
    ).toBe('18.3.1');
  });
});

describe('parse cost', () => {
  it('pnpm: the packages/snapshots graph is never handed to the YAML parser', () => {
    const head = readFileSync(fixture('pnpm-v6-single', 'pnpm-lock.yaml'), 'utf8').split(/^packages:/m)[0];
    // Not YAML at all past `packages:` — parsing it would throw.
    const text = `${head}packages:\n  : : [ {\n\nsnapshots:\n  ][\n`;
    expect(
      parseLockfile('pnpm-lock.yaml', text).lock?.versionOf('next', [{ path: '', range: '13.4.0' }]),
    ).toBe('13.4.0');
  });
});
