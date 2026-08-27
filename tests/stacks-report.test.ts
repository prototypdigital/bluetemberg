import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDetectReport, buildCoverageReport } from '../src/stacks/report.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-report-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(root: string, stacks?: Record<string, string>): void {
  writeFileSync(
    join(root, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['claude'], source: 'llm', targets: {}, ...(stacks ? { stacks } : {}) }),
  );
}

function writeCatalog(root: string, packs: unknown[]): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({ generated: '2026-06-15T00:00:00.000Z', packs }),
  );
}

/** Write a rule into the project source dir, optionally with a `stacks:` constraint. */
function writeRule(root: string, name: string, stacks?: string): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  const frontmatter = stacks
    ? `---\ndescription: r\nstacks:\n  ${stacks}\n---\n`
    : '---\ndescription: r\n---\n';
  writeFileSync(join(root, 'llm', 'rules', `${name}.md`), `${frontmatter}\nbody\n`);
}

const PAYLOAD_PACK = {
  name: 'bluetemberg-rules-payload',
  version: '0.1.0',
  description: '',
  kind: 'rules',
  universal: false,
  profiles: [],
  stacks: ['payload'],
  rules: ['payload-thing'],
  preview: '',
};

const REACT_PACK = {
  name: 'bluetemberg-rules-react',
  version: '0.1.0',
  description: '',
  kind: 'rules',
  universal: false,
  profiles: [],
  stacks: ['react'],
  rules: ['effects-r18'],
  preview: '',
};

describe('buildDetectReport', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports declared stacks with high confidence and config source', () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root, [PAYLOAD_PACK]);

    const report = buildDetectReport(root);
    const payload = report.detected.find((e) => e.stack === 'payload');
    expect(payload).toMatchObject({ resolvedVersion: '3.4.1', confidence: 'declared', source: 'config' });
    expect(payload?.coverage.covered).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('lists a detected stack with no covering pack as a no-coverage gap', () => {
    writeConfig(root, { nextjs: '15.2.0' });
    writeCatalog(root, [PAYLOAD_PACK]); // catalog covers payload, not nextjs

    const report = buildDetectReport(root);
    expect(report.gaps).toContainEqual({
      stack: 'nextjs',
      resolvedVersion: '15.2.0',
      reason: 'no-coverage',
    });
  });

  it('lists a detected stack whose covered ranges miss its version as a version-uncovered gap', () => {
    // The motivating case: react guidance exists, but only for 18 — a react 19 project is a gap.
    writeConfig(root, { react: '19.0.0' });
    writeCatalog(root, [REACT_PACK]);
    writeRule(root, 'effects-r18', 'react: ">=18 <19"');

    const report = buildDetectReport(root);
    expect(report.gaps).toContainEqual({
      stack: 'react',
      resolvedVersion: '19.0.0',
      reason: 'version-uncovered',
    });
  });

  it('ranks a version covered only by a wildcard as weak coverage, not as covered-and-done', () => {
    // The masking case: one unbounded sibling in the same pack re-opens `*`, so react 19 is
    // covered — but only generically. It must not vanish into "covered" alongside react 18.
    writeConfig(root, { react: '19.0.0' });
    writeCatalog(root, [{ ...REACT_PACK, rules: ['effects-r18', 'naming'] }]);
    writeRule(root, 'effects-r18', 'react: ">=18 <19"');
    writeRule(root, 'naming'); // no stacks: → inherits the pack's name-level tag

    const report = buildDetectReport(root);
    expect(report.gaps).toEqual([]);
    expect(report.weakCoverage).toEqual([{ stack: 'react', resolvedVersion: '19.0.0' }]);
    expect(report.detected.find((e) => e.stack === 'react')?.coverage).toMatchObject({
      covered: true,
      precision: 'name-level',
      matchedRange: '*',
    });
  });

  it('covers a version that a declared range does satisfy', () => {
    writeConfig(root, { react: '18.3.0' });
    writeCatalog(root, [REACT_PACK]);
    writeRule(root, 'effects-r18', 'react: ">=18 <19"');

    const report = buildDetectReport(root);
    expect(report.gaps).toEqual([]);
    expect(report.weakCoverage).toEqual([]);
    expect(report.detected.find((e) => e.stack === 'react')?.coverage).toMatchObject({
      covered: true,
      matchedRange: '>=18 <19',
      precision: 'version',
      reason: null,
    });
  });

  it('warns (never silently drops) on a low-confidence coerced version', () => {
    writeConfig(root); // no declared stacks
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { payload: '^3.4.0' } }),
    );
    writeCatalog(root, [PAYLOAD_PACK]);

    const report = buildDetectReport(root);
    const payload = report.detected.find((e) => e.stack === 'payload');
    expect(payload?.confidence).toBe('coerced');
    expect(report.warnings.some((w) => w.stack === 'payload' && w.level === 'low-confidence')).toBe(true);
  });

  it('degrades to catalog-only coverage (with a warning) when a manifest cannot be read', () => {
    // `detect` is a read-only diagnostic an agent calls at session start — a corrupt manifest must
    // not make detection unreadable too, and must not silently shrink coverage either.
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root, [PAYLOAD_PACK]);
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'packages.json'), 'this is not json');

    const report = buildDetectReport(root);
    expect(report.detected.find((e) => e.stack === 'payload')?.resolvedVersion).toBe('3.4.1');
    const warning = report.warnings.find((w) => w.level === 'coverage-source');
    expect(warning?.stack).toBeNull();
    expect(warning?.message).toMatch(/packages\.json could not be read/);
  });

  it('reports no stacks when none are declared or present', () => {
    writeConfig(root);
    const report = buildDetectReport(root);
    expect(report.detected).toEqual([]);
  });
});

describe('buildCoverageReport', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('answers known + covered for a cataloged stack', () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root, [PAYLOAD_PACK]);

    const report = buildCoverageReport(root, 'payload', '3.4.1');
    expect(report.query).toEqual({ stack: 'payload', version: '3.4.1' });
    expect(report.result.known).toBe(true);
    expect(report.result.covered).toBe(true);
    expect(report.result.origins).toContain('catalog');
  });

  it('answers unknown for a stack no pack or dependency knows', () => {
    writeConfig(root);
    writeCatalog(root, [PAYLOAD_PACK]);

    const report = buildCoverageReport(root, 'cobol');
    expect(report.result.known).toBe(false);
    expect(report.result.covered).toBe(false);
    expect(report.result.reason).toBe('no-coverage');
  });

  it('surfaces an unreadable coverage source rather than answering from a shrunken corpus', () => {
    writeConfig(root);
    writeCatalog(root, [PAYLOAD_PACK]);
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'packages.json'), 'this is not json');

    const report = buildCoverageReport(root, 'payload', '3.4.1');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/packages\.json could not be read/);
  });

  it('answers version-uncovered against the ranges the available guidance declares', () => {
    writeConfig(root);
    writeCatalog(root, [REACT_PACK]);
    writeRule(root, 'effects-r18', 'react: ">=18 <19"');

    const report = buildCoverageReport(root, 'react', '19.0.0');
    expect(report.result).toMatchObject({
      known: true,
      covered: false,
      reason: 'version-uncovered',
      coveredRanges: ['>=18 <19'],
    });
  });
});
