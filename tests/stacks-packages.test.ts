import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Catalog } from '../src/catalog/index.js';
import { detectStacks, detectStacksFromManifests } from '../src/stacks/detect.js';
import {
  BUILTIN_STACK_PACKAGES,
  STACK_PACKAGES_SCHEMA,
  buildStackPackages,
  builtinStackPackages,
  packageForStack,
  withImpliedStacks,
} from '../src/stacks/packages.js';
import { resolveLatestVersions } from '../src/stacks/latest.js';
import { buildDetectReport } from '../src/stacks/report.js';
import { buildWhyReport } from '../src/stacks/why.js';
import { sync } from '../src/sync/index.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-stackpkgs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The committed snapshot, read the way the engine ships it. */
function snapshot(): Catalog {
  return JSON.parse(readFileSync(new URL('../src/catalog/catalog.json', import.meta.url), 'utf8')) as Catalog;
}

function withBlock(stackPackages: unknown): Pick<Catalog, 'stackPackages'> {
  return { stackPackages };
}

/** The built-in table expressed as catalog data — what the packs repo would publish to mirror it. */
function builtinAsData(): Pick<Catalog, 'stackPackages'> {
  return withBlock({
    schema: STACK_PACKAGES_SCHEMA,
    stacks: Object.fromEntries(
      Object.entries(BUILTIN_STACK_PACKAGES).map(([stack, npm]) => [stack, { packages: { npm } }]),
    ),
  });
}

function writeManifest(root: string, deps: Record<string, string>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: deps }));
}

function writeInstalled(root: string, pkg: string, version: string): void {
  const dir = join(root, 'node_modules', ...pkg.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version }));
}

function writeCatalogCache(root: string, stackPackages: unknown): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({ generated: '2026-11-03T00:00:00.000Z', packs: [], stackPackages }),
  );
}

describe('built-in mappings resolve identically through the data path', () => {
  const builtinStacks = Object.keys(BUILTIN_STACK_PACKAGES);

  it.each(builtinStacks)('%s maps to the same package via the snapshot and via catalog data', (stack) => {
    const expected = BUILTIN_STACK_PACKAGES[stack];
    expect(packageForStack(stack)).toBe(expected);
    expect(packageForStack(stack, buildStackPackages(snapshot()).packages)).toBe(expected);
    expect(packageForStack(stack, buildStackPackages(builtinAsData()).packages)).toBe(expected);
  });

  it('the committed snapshot parses with no issues and implies nothing for built-in stacks', () => {
    const { packages, issues } = buildStackPackages(snapshot());
    expect(issues).toEqual([]);
    for (const stack of builtinStacks) expect(packages.get(stack)?.implies).toEqual([]);
  });

  it('detects every built-in stack the same way on disk, whichever map is used', () => {
    const root = createTmpDir();
    try {
      const deps: Record<string, string> = {};
      Object.values(BUILTIN_STACK_PACKAGES).forEach((pkg, i) => {
        deps[pkg] = `^${i + 1}.0.0`;
        if (i % 2 === 0) writeInstalled(root, pkg, `${i + 1}.2.3`); // half exact, half coerced
      });
      writeManifest(root, deps);

      const viaBuiltin = detectStacks(root, undefined, builtinStackPackages());
      expect([...viaBuiltin.keys()].sort()).toEqual([...builtinStacks].sort());
      expect(detectStacks(root)).toEqual(viaBuiltin); // default: project catalog → snapshot
      expect(detectStacks(root, undefined, buildStackPackages(snapshot()).packages)).toEqual(viaBuiltin);
      expect(detectStacks(root, undefined, buildStackPackages(builtinAsData()).packages)).toEqual(viaBuiltin);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects every built-in stack the same way from remote manifests, whichever map is used', () => {
    const manifest = {
      dependencies: Object.fromEntries(Object.values(BUILTIN_STACK_PACKAGES).map((p) => [p, '^2'])),
    };
    const lock = { packages: { 'node_modules/next': { version: '15.3.1' } } };
    const viaBuiltin = detectStacksFromManifests(manifest, lock);
    expect(
      detectStacksFromManifests(manifest, lock, undefined, buildStackPackages(snapshot()).packages),
    ).toEqual(viaBuiltin);
    expect(
      detectStacksFromManifests(manifest, lock, undefined, buildStackPackages(builtinAsData()).packages),
    ).toEqual(viaBuiltin);
  });
});

describe('buildStackPackages: catalog over built-in', () => {
  it('adds a new stack and remaps an existing one, catalog winning', () => {
    const { packages, issues } = buildStackPackages(
      withBlock({
        schema: 1,
        stacks: {
          expo: { packages: { npm: 'expo' } },
          tailwind: { packages: { npm: '@tailwindcss/postcss' } },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(packageForStack('expo', packages)).toBe('expo');
    expect(packageForStack('tailwind', packages)).toBe('@tailwindcss/postcss');
    expect(packageForStack('react', packages)).toBe('react'); // untouched built-in survives
  });

  it('keeps the built-in package when an entry only adds `implies`', () => {
    const { packages } = buildStackPackages(
      withBlock({ schema: 1, stacks: { nextjs: { implies: ['react'] } } }),
    );
    expect(packages.get('nextjs')).toEqual({ npm: 'next', implies: ['react'] });
  });

  it('ignores ecosystems it has no reader for, and unknown fields', () => {
    const { packages, issues } = buildStackPackages(
      withBlock({ schema: 1, stacks: { django: { packages: { pypi: 'Django' }, notes: 'x' } } }),
    );
    expect(issues).toEqual([]);
    // No npm package: falls back to the identity mapping, exactly like an unmapped stack today.
    expect(packageForStack('django', packages)).toBe('django');
  });

  it('ignores a newer schema as a whole and says to upgrade', () => {
    const { packages, issues } = buildStackPackages(
      withBlock({ schema: 2, stacks: { react: { packages: { npm: 'preact' } } } }),
    );
    expect(packageForStack('react', packages)).toBe('react');
    expect(issues).toEqual([expect.stringContaining('schema 2 is newer than this engine reads (1)')]);
  });

  it.each([
    ['not an object', 'nope'],
    ['an array', []],
    ['no schema', { stacks: {} }],
    ['a string schema', { schema: '1', stacks: {} }],
    ['a fractional schema', { schema: 1.5, stacks: {} }],
    ['stacks as an array', { schema: 1, stacks: [] }],
  ])('ignores a malformed block (%s) with one issue', (_label, block) => {
    const { packages, issues } = buildStackPackages(withBlock(block));
    expect(issues).toHaveLength(1);
    expect([...packages]).toEqual([...builtinStackPackages()]);
  });

  it.each([
    ['a non-object entry', 'next'],
    ['packages as a string', { packages: 'next' }],
    ['a path-traversal package', { packages: { npm: '../../etc' } }],
    ['an uppercase package', { packages: { npm: 'React' } }],
    ['a numeric package', { packages: { npm: 7 } }],
    ['implies as a string', { implies: 'react' }],
    ['implies with a bad name', { implies: ['Re act'] }],
  ])('drops a bad entry (%s) and keeps the built-in mapping', (_label, entry) => {
    const { packages, issues } = buildStackPackages(withBlock({ schema: 1, stacks: { react: entry } }));
    expect(packages.get('react')).toEqual({ npm: 'react', implies: [] });
    expect(issues).toEqual([expect.stringContaining('stackPackages.stacks.react:')]);
  });

  it('drops an entry whose stack name is not a single token', () => {
    const { packages, issues } = buildStackPackages(
      withBlock({ schema: 1, stacks: { 'My Stack': { packages: { npm: 'x' } } } }),
    );
    expect(packages.has('My Stack')).toBe(false);
    expect(issues).toHaveLength(1);
  });

  it('drops a self-implication but keeps the rest of the entry', () => {
    const { packages, issues } = buildStackPackages(
      withBlock({ schema: 1, stacks: { nextjs: { implies: ['nextjs', 'react', 'react'] } } }),
    );
    expect(packages.get('nextjs')?.implies).toEqual(['react']);
    expect(issues).toEqual([expect.stringContaining('implies itself')]);
  });
});

describe('withImpliedStacks', () => {
  it('closes transitively and records who implied each stack', () => {
    const { packages } = buildStackPackages(
      withBlock({
        schema: 1,
        stacks: { expo: { implies: ['react-native'] }, 'react-native': { implies: ['react'] } },
      }),
    );
    expect([...withImpliedStacks(['expo'], packages)]).toEqual([
      ['expo', null],
      ['react-native', 'expo'],
      ['react', 'react-native'],
    ]);
  });

  it('terminates on a cycle', () => {
    const { packages } = buildStackPackages(
      withBlock({
        schema: 1,
        stacks: { a: { implies: ['b'] }, b: { implies: ['c'] }, c: { implies: ['a'] } },
      }),
    );
    expect([...withImpliedStacks(['a'], packages).keys()]).toEqual(['a', 'b', 'c']);
  });

  it('keeps a directly present stack direct even when another stack implies it', () => {
    const { packages } = buildStackPackages(
      withBlock({ schema: 1, stacks: { nextjs: { implies: ['react'] } } }),
    );
    expect(withImpliedStacks(['nextjs', 'react'], packages).get('react')).toBeNull();
  });
});

describe('detection with a catalog stack map', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the project catalog cache by default', () => {
    writeManifest(root, { expo: '~52.0.0' });
    writeInstalled(root, 'expo', '52.0.11');
    // Unmapped: only a declared stack falls back to the identity mapping, so nothing is detected.
    expect(detectStacks(root).size).toBe(0);

    writeCatalogCache(root, { schema: 1, stacks: { 'expo-sdk': { packages: { npm: 'expo' } } } });
    expect(detectStacks(root).get('expo-sdk')).toEqual({
      version: '52.0.11',
      confidence: 'exact',
      source: 'node_modules',
    });
  });

  it('detects an implied stack only when it is actually installed, and labels it', () => {
    writeManifest(root, { next: '^15.0.0' }); // react not a direct dependency
    writeInstalled(root, 'next', '15.3.1');
    const packages = buildStackPackages(
      withBlock({ schema: 1, stacks: { nextjs: { implies: ['react'] } } }),
    ).packages;

    expect(detectStacks(root, undefined, packages).has('react')).toBe(false); // nothing to read: never guessed

    writeInstalled(root, 'react', '19.1.0');
    expect(detectStacks(root, undefined, packages).get('react')).toEqual({
      version: '19.1.0',
      confidence: 'exact',
      source: 'node_modules, implied by nextjs',
    });
    // Without the catalog entry, today's behaviour: react is not a direct dependency, so not detected.
    expect(detectStacks(root, undefined, builtinStackPackages()).has('react')).toBe(false);
  });

  it('never coerces an implied stack from a range it does not have', () => {
    const packages = buildStackPackages(
      withBlock({ schema: 1, stacks: { nextjs: { implies: ['react'] } } }),
    ).packages;
    const d = detectStacksFromManifests({ dependencies: { next: '^15' } }, null, undefined, packages);
    expect([...d.keys()]).toEqual(['nextjs']);
    const withLock = detectStacksFromManifests(
      { dependencies: { next: '^15' } },
      { packages: { 'node_modules/react': { version: '19.0.0' } } },
      undefined,
      packages,
    );
    expect(withLock.get('react')?.source).toBe('package-lock.json, implied by nextjs');
  });

  it('surfaces ignored stack-map data in the detect report', () => {
    writeManifest(root, {});
    writeCatalogCache(root, { schema: 9, stacks: {} });
    expect(buildDetectReport(root).warnings).toEqual([
      expect.objectContaining({
        stack: null,
        level: 'stack-map',
        message: expect.stringContaining('schema 9'),
      }),
    ]);
  });
});

describe('why/sync parity on the catalog stack map', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('gates a rule on a catalog-only stack the same way in why and sync, and warns the same', async () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm' }),
    );
    writeManifest(root, { expo: '~52.0.0' });
    writeInstalled(root, 'expo', '52.0.11');
    writeCatalogCache(root, {
      schema: 1,
      stacks: { 'expo-sdk': { packages: { npm: 'expo' } }, broken: { packages: { npm: '../x' } } },
    });
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    const rule = (name: string, range: string): void =>
      writeFileSync(
        join(root, 'llm', 'rules', `${name}.md`),
        `---\ndescription: ${name}\nstacks:\n  expo-sdk: "${range}"\n---\n\n# ${name}\n`,
      );
    rule('sdk-52', '>=52 <53');
    rule('sdk-51', '>=51 <52');

    const results = await sync(root, { silent: true });

    for (const id of ['sdk-52', 'sdk-51']) {
      const report = buildWhyReport(root, id);
      expect(report.matches).toHaveLength(1);
      expect(existsSync(join(root, '.claude', 'rules', `${id}.md`)), id).toBe(report.matches[0].included);
      const stackMapWarnings = report.warnings.filter((w) => w.startsWith('catalog stackPackages'));
      expect(stackMapWarnings).toHaveLength(1);
      expect(results.warnings).toEqual(expect.arrayContaining(stackMapWarnings));
    }
    expect(buildWhyReport(root, 'sdk-52').matches[0].included).toBe(true);
    expect(buildWhyReport(root, 'sdk-51').matches[0].included).toBe(false);
  });
});

describe('adversarial stack-map data', () => {
  it('never detects a stack from Object.prototype keys', () => {
    const packages = buildStackPackages(
      withBlock({
        schema: 1,
        stacks: {
          constructor: { packages: { npm: 'constructor' } },
          nextjs: { implies: ['tostring', 'constructor'] },
        },
      }),
    ).packages;
    const d = detectStacksFromManifests({ dependencies: { next: '^15' } }, null, undefined, packages);
    expect([...d.keys()]).toEqual(['nextjs']);
  });

  it('warns when two catalog entries map the same package, but not for a built-in rename', () => {
    const { issues } = buildStackPackages(
      withBlock({
        schema: 1,
        stacks: {
          expo: { packages: { npm: 'expo' } },
          'expo-sdk': { packages: { npm: 'expo' } },
          tailwindcss: { packages: { npm: 'tailwindcss' } }, // shares the built-in `tailwind` package
        },
      }),
    );
    expect(issues).toEqual(['stackPackages.stacks.expo-sdk: package "expo" is also mapped by expo']);
  });

  it('lints a packs repo against its own catalog.json stack map', async () => {
    const root = createTmpDir();
    try {
      mkdirSync(join(root, 'packages', 'bluetemberg-rules-expo', 'llm'), { recursive: true });
      writeFileSync(
        join(root, 'catalog.json'),
        JSON.stringify({
          generated: '2026-11-03T00:00:00.000Z',
          packs: [],
          stackPackages: { schema: 1, stacks: { 'expo-sdk': { packages: { npm: 'expo' } } } },
        }),
      );
      const asked: string[] = [];
      const [lookup] = await resolveLatestVersions(root, ['expo-sdk'], {
        cacheFile: join(root, 'cache.json'),
        fetchLatest: async (pkg) => {
          asked.push(pkg);
          return '52.0.0';
        },
      });
      expect(asked).toEqual(['expo']);
      expect(lookup.package).toBe('expo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
