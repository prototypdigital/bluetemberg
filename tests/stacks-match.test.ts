import { describe, it, expect } from 'vitest';
import {
  isValidStackRange,
  versionSatisfies,
  invalidRanges,
  matchStackConstraint,
  compareSpecificity,
  type DetectedStacks,
} from '../src/stacks/match.js';

function detected(entries: Record<string, string>): DetectedStacks {
  const m: DetectedStacks = new Map();
  for (const [name, version] of Object.entries(entries)) {
    m.set(name, { version, confidence: 'exact', source: 'test' });
  }
  return m;
}

describe('isValidStackRange', () => {
  it('accepts valid semver ranges and the wildcard/auto sentinels', () => {
    for (const r of ['>=3 <4', '^17.0.0', '13.4 - 16', '1.x', '*', '', 'auto']) {
      expect(isValidStackRange(r)).toBe(true);
    }
  });
  it('rejects garbage ranges', () => {
    for (const r of ['not-a-range', '>=', '3..4']) expect(isValidStackRange(r)).toBe(false);
  });
});

describe('versionSatisfies', () => {
  it('matches versions inside the range', () => {
    expect(versionSatisfies('3.4.1', '>=3 <4')).toBe(true);
    expect(versionSatisfies('17.2.0', '>=17')).toBe(true);
    expect(versionSatisfies('15.3.1', '>=13.4')).toBe(true);
  });
  it('excludes versions outside the range (hard exclude)', () => {
    expect(versionSatisfies('2.30.0', '>=3 <4')).toBe(false);
    expect(versionSatisfies('14.0.0', '>=17')).toBe(false);
  });
  it('includes prereleases so a canary matches its major', () => {
    expect(versionSatisfies('15.0.0-canary.3', '>=15')).toBe(true);
  });
  it('wildcard/empty matches anything; invalid range never matches', () => {
    expect(versionSatisfies('1.0.0', '*')).toBe(true);
    expect(versionSatisfies('1.0.0', '')).toBe(true);
    expect(versionSatisfies('1.0.0', 'garbage')).toBe(false);
  });
});

describe('invalidRanges', () => {
  it('reports only the malformed entries', () => {
    expect(invalidRanges({ payload: '>=3 <4', next: 'garbage' })).toEqual(['next: "garbage"']);
    expect(invalidRanges({ payload: '>=3' })).toEqual([]);
  });
});

describe('matchStackConstraint', () => {
  it('matches when every stack is present and in range (agnostic = always)', () => {
    expect(matchStackConstraint(undefined, detected({})).matched).toBe(true);
    expect(matchStackConstraint({}, detected({ payload: '3.4.1' })).matched).toBe(true);
    expect(matchStackConstraint({ payload: '>=3 <4' }, detected({ payload: '3.4.1' })).matched).toBe(true);
  });
  it('fails (with reasons) when a stack is missing', () => {
    const r = matchStackConstraint({ payload: '>=3' }, detected({ nextjs: '15.0.0' }));
    expect(r.matched).toBe(false);
    expect(r.missing).toEqual(['payload']);
  });
  it('fails (with reasons) when the version is out of range', () => {
    const r = matchStackConstraint({ payload: '>=3 <4' }, detected({ payload: '2.30.0' }));
    expect(r.matched).toBe(false);
    expect(r.mismatched).toEqual([{ stack: 'payload', range: '>=3 <4', detected: '2.30.0' }]);
  });
  it('flags low-confidence detections without failing the match', () => {
    const m: DetectedStacks = new Map([
      ['payload', { version: '3.0.0', confidence: 'coerced', source: 'package.json' }],
    ]);
    const r = matchStackConstraint({ payload: '>=3' }, m);
    expect(r.matched).toBe(true);
    expect(r.lowConfidence).toEqual(['payload']);
  });
});

describe('compareSpecificity', () => {
  it('orders narrower ranges before wider ones, deterministically', () => {
    const sorted = ['*', '>=3', '>=3 <4'].sort(compareSpecificity);
    expect(sorted[0]).toBe('>=3 <4'); // most specific first
    expect(sorted[sorted.length - 1]).toBe('*'); // least specific last
  });
  it('is stable for equal specificity (lexical tie-break)', () => {
    expect(compareSpecificity('>=3 <4', '>=3 <4')).toBe(0);
  });
});
