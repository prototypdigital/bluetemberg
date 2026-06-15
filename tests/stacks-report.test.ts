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

  it('lists a detected stack with no covering pack as a gap', () => {
    writeConfig(root, { nextjs: '15.2.0' });
    writeCatalog(root, [PAYLOAD_PACK]); // catalog covers payload, not nextjs

    const report = buildDetectReport(root);
    expect(report.gaps).toContainEqual({
      stack: 'nextjs',
      resolvedVersion: '15.2.0',
      reason: 'version-uncovered',
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
  });
});
