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
import { buildRangeLintReport } from '../src/stacks/ranges.js';
import { buildScanReport } from '../src/stacks/scan.js';
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
      // Every resolution path at once, rotating through the built-ins: node_modules, the lockfile,
      // and a coerced manifest range — plus a config pin and an `auto` entry on top.
      const pkgs = Object.values(BUILTIN_STACK_PACKAGES);
      const deps: Record<string, string> = { lodash: '^4.0.0' };
      const lockPackages: Record<string, { version: string }> = {};
      pkgs.forEach((pkg, i) => {
        deps[pkg] = `^${i + 1}.0.0`;
        if (i % 3 === 0) writeInstalled(root, pkg, `${i + 1}.2.3`);
        if (i % 3 === 1) lockPackages[`node_modules/${pkg}`] = { version: `${i + 1}.4.5` };
      });
      writeManifest(root, deps);
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 3, packages: lockPackages }),
      );
      const config = { stacks: { payload: '3.4.1', vue: 'auto', custom: '1.0.0' } };

      // The expectation is written out from the detection rules, not computed by the code under test.
      const expected = Object.entries(BUILTIN_STACK_PACKAGES).map(([stack], i) => {
        if (stack === 'payload')
          return [stack, { version: '3.4.1', confidence: 'declared', source: 'config' }];
        if (i % 3 === 0)
          return [stack, { version: `${i + 1}.2.3`, confidence: 'exact', source: 'node_modules' }];
        if (i % 3 === 1)
          return [stack, { version: `${i + 1}.4.5`, confidence: 'exact', source: 'package-lock.json' }];
        return [stack, { version: `${i + 1}.0.0`, confidence: 'coerced', source: 'package.json' }];
      });
      const byKey = new Map(expected.map(([k, v]) => [k, v]));
      // Insertion order: declared names first (config key order), then the remaining mapped stacks.
      const order = [...Object.keys(config.stacks), ...Object.keys(BUILTIN_STACK_PACKAGES)].filter(
        (s, i, all) => all.indexOf(s) === i && (byKey.has(s) || s === 'custom'),
      );
      const golden = order.map((s) =>
        s === 'custom'
          ? [s, { version: '1.0.0', confidence: 'declared', source: 'config' }]
          : [s, byKey.get(s)],
      );

      for (const packages of [
        builtinStackPackages(),
        buildStackPackages(snapshot()).packages,
        buildStackPackages(builtinAsData()).packages,
      ]) {
        expect([...detectStacks(root, config, packages).entries()]).toEqual(golden);
      }
      expect([...detectStacks(root, config).entries()]).toEqual(golden); // default: project catalog → snapshot
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

  it('warns when two stacks map one package, built-in aliases included', () => {
    const { issues } = buildStackPackages(
      withBlock({
        schema: 1,
        stacks: {
          expo: { packages: { npm: 'expo' } },
          'expo-sdk': { packages: { npm: 'expo' } },
          tailwindcss: { packages: { npm: 'tailwindcss' } }, // aliases the built-in `tailwind`
          tailwind: { packages: { npm: 'tailwindcss' } }, // restating a built-in is not a conflict
          nextjs: { implies: ['react'] }, // keeps the built-in package: not a conflict either
        },
      }),
    );
    expect(issues).toEqual([
      'stackPackages.stacks.expo-sdk: package "expo" is also mapped by expo — both names are detected',
      'stackPackages.stacks.tailwindcss: package "tailwindcss" is also mapped by tailwind (built-in) — both names are detected',
    ]);
  });

  it('does not auto-detect a stack mapped only to another ecosystem', () => {
    const packages = buildStackPackages(
      withBlock({ schema: 1, stacks: { rails: { packages: { rubygems: 'rails' } } } }),
    ).packages;
    expect(
      detectStacksFromManifests({ dependencies: { rails: '^0.5.0' } }, null, undefined, packages).size,
    ).toBe(0);
    // Declared, it still resolves by its own name — like any unmapped stack.
    const declared = detectStacksFromManifests({}, null, { stacks: { rails: '7.1.0' } }, packages);
    expect(declared.get('rails')?.version).toBe('7.1.0');
  });

  it('reports an unusable entry for a stack with no built-in as unmapped', () => {
    const { issues } = buildStackPackages(withBlock({ schema: 1, stacks: { expo: 'expo' } }));
    expect(issues).toEqual([
      'stackPackages.stacks.expo: entry must be an object — ignored, the stack stays unmapped',
    ]);
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

  it('surfaces ignored stack-map data in the range lint report', async () => {
    const root = createTmpDir();
    try {
      mkdirSync(join(root, 'packages', 'bluetemberg-rules-expo', 'llm'), { recursive: true });
      writeFileSync(
        join(root, 'catalog.json'),
        JSON.stringify({
          generated: '2026-11-03T00:00:00.000Z',
          packs: [],
          stackPackages: { schema: 2, stacks: {} },
        }),
      );
      const report = await buildRangeLintReport(root, { offline: true, cacheFile: join(root, 'cache.json') });
      expect(report.warnings).toEqual([expect.stringContaining('catalog stackPackages ignored: schema 2')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('monorepos and scan-org read the same stack map', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function monorepo(): string {
    mkdirSync(join(root, '.git'));
    writeCatalogCache(root, { schema: 1, stacks: { 'expo-sdk': { packages: { npm: 'expo' } } } });
    const app = join(root, 'packages', 'app');
    mkdirSync(app, { recursive: true });
    writeManifest(app, { expo: '~52.0.0' });
    writeInstalled(app, 'expo', '52.0.11');
    return app;
  }

  it('a package without its own cache detects with the repo root cache', () => {
    const app = monorepo();
    expect(detectStacks(app).get('expo-sdk')?.version).toBe('52.0.11');
  });

  it('a package cache wins over the root one', () => {
    const app = monorepo();
    writeCatalogCache(app, { schema: 1, stacks: { expo: { packages: { npm: 'expo' } } } });
    expect([...detectStacks(app).keys()]).toEqual(['expo']);
  });

  it('never climbs past the repo boundary', () => {
    const app = monorepo();
    rmSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(app, '.git'));
    expect(detectStacks(app).size).toBe(0);
  });

  it('why in a package agrees with sync fanned out from the root', async () => {
    const app = monorepo();
    for (const dir of [root, app]) {
      writeFileSync(
        join(dir, 'bluetemberg.config.json'),
        JSON.stringify({ platforms: ['claude'], source: 'llm' }),
      );
    }
    mkdirSync(join(app, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(app, 'llm', 'rules', 'sdk-52.md'),
      '---\ndescription: sdk-52\nstacks:\n  expo-sdk: ">=52 <53"\n---\n\n# sdk-52\n',
    );
    await sync(root, { silent: true });
    const item = buildWhyReport(app, 'sdk-52').matches[0];
    expect(item.included).toBe(true);
    expect(existsSync(join(app, '.claude', 'rules', 'sdk-52.md'))).toBe(true);
  });

  it('scan-org detects local repos with the scanner catalog, like the remote path', () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    writeManifest(repo, { expo: '~52.0.0' });
    writeInstalled(repo, 'expo', '52.0.11');
    writeCatalogCache(root, { schema: 1, stacks: { 'expo-sdk': { packages: { npm: 'expo' } } } });
    const report = buildScanReport([repo], root);
    expect(report.histogram.map((h) => h.stack)).toEqual(['expo-sdk']);
    const remote = detectStacksFromManifests(
      { dependencies: { expo: '~52.0.0' } },
      { packages: { 'node_modules/expo': { version: '52.0.11' } } },
      undefined,
      buildStackPackages({
        stackPackages: { schema: 1, stacks: { 'expo-sdk': { packages: { npm: 'expo' } } } },
      }).packages,
    );
    expect([...remote.keys()]).toEqual(['expo-sdk']);
  });
});
