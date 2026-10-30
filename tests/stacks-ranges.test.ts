import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rangeHasUpperBound, rangesIntersect, unreleasedLineRange } from '../src/stacks/match.js';
import { resolveLatestVersions } from '../src/stacks/latest.js';
import {
  buildRangeLintReport,
  buildRangeListReport,
  formatRangeLint,
  formatRangeList,
} from '../src/stacks/ranges.js';
import { installFakePack } from './helpers/installed-pack.js';

/**
 * Range lifecycle (#294): the lint flags ranges that apply to versions nobody checked the guidance
 * against, and the list answers "which guidance is pinned to this stack/version". The registry is
 * always injected here — no test reaches the network.
 */

let root: string;
let cacheFile: string;

beforeEach(() => {
  root = join(tmpdir(), `bt-ranges-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  cacheFile = join(root, 'cache', 'latest-versions.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeRule(dir: string, name: string, stacks: Record<string, string>): void {
  const lines = Object.entries(stacks).map(([stack, range]) => `  ${stack}: "${range}"`);
  mkdirSync(join(dir, 'rules'), { recursive: true });
  writeFileSync(
    join(dir, 'rules', `${name}.md`),
    `---\ndescription: r\nstacks:\n${lines.join('\n')}\n---\n\nbody\n`,
  );
}

/** A registry stub: the latest version per npm package, or a thrown error for anything else. */
function registry(latest: Record<string, string>): (pkg: string) => Promise<string> {
  return vi.fn(async (pkg: string) => {
    const version = latest[pkg];
    if (!version) throw new Error(`no such package ${pkg}`);
    return version;
  });
}

describe('range helpers', () => {
  it('rangeHasUpperBound: every alternative must be capped', () => {
    expect(rangeHasUpperBound('>=3 <4')).toBe(true);
    expect(rangeHasUpperBound('^3')).toBe(true);
    expect(rangeHasUpperBound('3.x')).toBe(true);
    expect(rangeHasUpperBound('3.4.1')).toBe(true);
    expect(rangeHasUpperBound('<=15.2')).toBe(true);
    expect(rangeHasUpperBound('>=3')).toBe(false);
    expect(rangeHasUpperBound('>13.4')).toBe(false);
    expect(rangeHasUpperBound('^2 || >=4')).toBe(false);
    expect(rangeHasUpperBound('*')).toBe(false);
    expect(rangeHasUpperBound('not-a-range')).toBe(false);
  });

  it('rangesIntersect: some version satisfies both', () => {
    expect(rangesIntersect('>=3 <4', '3.4.1')).toBe(true);
    expect(rangesIntersect('>=3 <4', '3')).toBe(true);
    expect(rangesIntersect('^2', '>=2.5 <5')).toBe(true);
    expect(rangesIntersect('>=3 <4', '4')).toBe(false);
    expect(rangesIntersect('*', '9')).toBe(true);
    expect(rangesIntersect('not-a-range', '3')).toBe(false);
  });

  it('unreleasedLineRange: the next major, or the next minor for a 0.x stack', () => {
    expect(unreleasedLineRange('5.2.0')).toBe('>=6.0.0');
    expect(unreleasedLineRange('0.81.4')).toBe('>=0.82.0');
    expect(unreleasedLineRange('not-a-version')).toBeNull();
  });
});

describe('buildRangeLintReport', () => {
  it('flags an open-ended range', async () => {
    writeRule(join(root, 'llm'), 'payload-open', { payload: '>=2' });

    const report = await buildRangeLintReport(root, {
      cacheFile,
      fetchLatest: registry({ payload: '3.92.1' }),
    });

    expect(report.mode).toBe('project');
    expect(report.checked).toBe(1);
    expect(report.findings).toEqual([
      expect.objectContaining({
        kind: 'open-ended',
        stack: 'payload',
        range: '>=2',
        from: 'rules/payload-open',
        origin: 'local',
        latest: '3.92.1',
      }),
    ]);
  });

  it('flags a bounded range that reaches past the latest released major', async () => {
    writeRule(join(root, 'llm'), 'payload-wide', { payload: '>=3 <6' });

    const report = await buildRangeLintReport(root, {
      cacheFile,
      fetchLatest: registry({ payload: '4.2.0' }),
    });

    expect(report.findings).toEqual([
      expect.objectContaining({ kind: 'past-latest-major', range: '>=3 <6', latest: '4.2.0' }),
    ]);
  });

  it('passes valid bounded ranges, including one covering the current major', async () => {
    writeRule(join(root, 'llm'), 'payload-3', { payload: '>=3 <4' });
    writeRule(join(root, 'llm'), 'next-15', { nextjs: '^15' });
    writeRule(join(root, 'llm'), 'rn-pinned', { 'react-native': '>=0.81 <0.83' });

    const fetchLatest = registry({ payload: '3.92.1', next: '15.5.0', 'react-native': '0.82.1' });
    const report = await buildRangeLintReport(root, { cacheFile, fetchLatest });

    expect(report.checked).toBe(3);
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([]);
    // Stack names map to their npm package via the stack registry (nextjs → next).
    expect(fetchLatest).toHaveBeenCalledWith('next');
  });

  it('flags a 0.x range that reaches past the latest minor line', async () => {
    writeRule(join(root, 'llm'), 'rn-wide', { 'react-native': '>=0.81 <0.90' });

    const report = await buildRangeLintReport(root, {
      cacheFile,
      fetchLatest: registry({ 'react-native': '0.82.1' }),
    });

    expect(report.findings.map((f) => f.kind)).toEqual(['past-latest-major']);
  });

  it('does not lint wildcard (name-level) declarations', async () => {
    writeRule(join(root, 'llm'), 'any-react', { react: '*' });

    const fetchLatest = registry({ react: '19.2.0' });
    const report = await buildRangeLintReport(root, { cacheFile, fetchLatest });

    expect(report.checked).toBe(0);
    expect(report.findings).toEqual([]);
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('works offline: no registry call, open-ended still flagged, the rest reported unchecked', async () => {
    writeRule(join(root, 'llm'), 'payload-open', { payload: '>=2' });
    writeRule(join(root, 'llm'), 'payload-wide', { payload: '>=3 <6' });

    const fetchLatest = registry({ payload: '4.2.0' });
    const report = await buildRangeLintReport(root, { cacheFile, offline: true, fetchLatest });

    expect(fetchLatest).not.toHaveBeenCalled();
    expect(report.findings.map((f) => [f.kind, f.range])).toEqual([['open-ended', '>=2']]);
    expect(report.unchecked).toEqual([{ stack: 'payload', package: 'payload', reason: 'offline' }]);
    expect(formatRangeLint(report)).toContain(
      'NOTE: could not check latest major for payload (offline) — only open-ended ranges were flagged for it',
    );
  });

  it('reports a registry failure as unchecked instead of throwing', async () => {
    writeRule(join(root, 'llm'), 'mystery', { 'not-on-npm': '>=1 <2' });

    const report = await buildRangeLintReport(root, { cacheFile, fetchLatest: registry({}) });

    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([
      { stack: 'not-on-npm', package: 'not-on-npm', reason: 'no such package not-on-npm' },
    ]);
  });

  it('lints the ranges of installed packs, not just the project source dir', async () => {
    const packDir = installFakePack(root, 'bluetemberg-rules-payload');
    writeRule(packDir, 'payload-open', { payload: '>=2' });

    const report = await buildRangeLintReport(root, { cacheFile, offline: true });

    expect(report.findings).toEqual([
      expect.objectContaining({ from: 'rules/payload-open', origin: 'catalog' }),
    ]);
  });

  it('lints a packs repo pack by pack, prefixing ids with the pack', async () => {
    writeFileSync(join(root, 'catalog.json'), '{}');
    writeRule(join(root, 'packages', 'rules-a', 'llm'), 'shared', { payload: '>=2' });
    writeRule(join(root, 'packages', 'rules-b', 'llm'), 'shared', { payload: '>=3 <4' });

    const report = await buildRangeLintReport(root, { cacheFile, offline: true });

    expect(report.mode).toBe('packs-repo');
    // Same-named files in two packs are two rules here — packs are not merged like project sources.
    expect(report.checked).toBe(2);
    expect(report.findings.map((f) => f.from)).toEqual(['rules-a/rules/shared']);
  });
});

describe('resolveLatestVersions cache', () => {
  const NOW = Date.parse('2026-10-30T12:00:00.000Z');
  const HOUR = 60 * 60 * 1000;

  it('writes successful lookups and answers from a fresh cache without the registry', async () => {
    await resolveLatestVersions(root, ['payload'], {
      cacheFile,
      now: () => NOW,
      fetchLatest: registry({ payload: '3.92.1' }),
    });
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toEqual({
      payload: { latest: '3.92.1', fetchedAt: '2026-10-30T12:00:00.000Z' },
    });

    const fetchLatest = registry({ payload: '9.9.9' });
    const [hit] = await resolveLatestVersions(root, ['payload'], {
      cacheFile,
      now: () => NOW + HOUR,
      fetchLatest,
    });
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(hit).toMatchObject({ latest: '3.92.1', source: 'cache' });
  });

  it('refreshes an expired entry, and falls back to it when the registry is unreachable', async () => {
    mkdirSync(join(cacheFile, '..'), { recursive: true });
    writeFileSync(
      cacheFile,
      JSON.stringify({ payload: { latest: '3.0.0', fetchedAt: '2026-01-01T00:00:00.000Z' } }),
    );

    const [refreshed] = await resolveLatestVersions(root, ['payload'], {
      cacheFile,
      now: () => NOW,
      fetchLatest: registry({ payload: '3.92.1' }),
    });
    expect(refreshed).toMatchObject({ latest: '3.92.1', source: 'registry' });

    writeFileSync(
      cacheFile,
      JSON.stringify({ payload: { latest: '3.0.0', fetchedAt: '2026-01-01T00:00:00.000Z' } }),
    );
    const [stale] = await resolveLatestVersions(root, ['payload'], {
      cacheFile,
      now: () => NOW,
      offline: true,
    });
    expect(stale).toMatchObject({
      latest: '3.0.0',
      source: 'stale-cache',
      note: 'offline; using the cached version',
    });
  });

  it('treats a corrupt cache as empty and does not write one when nothing was fetched', async () => {
    mkdirSync(join(cacheFile, '..'), { recursive: true });
    writeFileSync(cacheFile, 'not json');

    const [miss] = await resolveLatestVersions(root, ['payload'], { cacheFile, offline: true });
    expect(miss).toMatchObject({ latest: null, source: null, note: 'offline' });
    expect(readFileSync(cacheFile, 'utf8')).toBe('not json');
  });

  it('never writes a cache file for an offline run with no cache', async () => {
    await resolveLatestVersions(root, ['payload'], { cacheFile, offline: true });
    expect(existsSync(cacheFile)).toBe(false);
  });
});

describe('buildRangeListReport', () => {
  beforeEach(() => {
    writeRule(join(root, 'llm'), 'payload-2', { payload: '>=2 <3' });
    writeRule(join(root, 'llm'), 'payload-3', { payload: '>=3 <4', nextjs: '>=15 <16' });
    writeRule(join(root, 'llm'), 'payload-3-4', { payload: '>=3.4 <5' });
    writeRule(join(root, 'llm'), 'payload-any', { payload: '*' });
  });

  it('filters by an exact version', () => {
    const report = buildRangeListReport(root, 'payload', '3.2.0');

    expect(report.query).toEqual({ stack: 'payload', version: '3.2.0' });
    expect(report.matches.map((m) => m.from)).toEqual(['rules/payload-3']);
    expect(report.nameLevel.map((m) => m.from)).toEqual(['rules/payload-any']);
  });

  it('treats a partial version as its whole line ("payload 3" = any 3.x)', () => {
    const report = buildRangeListReport(root, 'payload', '3');
    expect(report.matches.map((m) => m.from)).toEqual(['rules/payload-3', 'rules/payload-3-4']);
  });

  it('filters by a range', () => {
    const report = buildRangeListReport(root, 'payload', '>=4 <5');
    expect(report.matches).toEqual([
      { stack: 'payload', range: '>=3.4 <5', from: 'rules/payload-3-4', origin: 'local' },
    ]);
  });

  it('lists every ranged declaration for the stack when no version is given', () => {
    const report = buildRangeListReport(root, 'payload');
    expect(report.matches.map((m) => m.range)).toEqual(['>=2 <3', '>=3 <4', '>=3.4 <5']);
  });

  it('returns nothing for a stack no guidance declares', () => {
    const report = buildRangeListReport(root, 'astro', '4');
    expect(report.matches).toEqual([]);
    expect(report.nameLevel).toEqual([]);
    expect(formatRangeList(report)).toEqual(['No guidance declares a range for astro that admits 4.']);
  });

  it('rejects an invalid version query instead of matching nothing', () => {
    expect(() => buildRangeListReport(root, 'payload', 'not-a-range')).toThrow('not a valid semver');
  });
});
