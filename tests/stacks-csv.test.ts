import { describe, expect, it } from 'vitest';

import { invalidStackVersions, parseStacksCsv } from '../src/init/stacks-csv.js';

describe('parseStacksCsv', () => {
  it('parses name@version and maps a bare name to "auto"', () => {
    expect(parseStacksCsv('payload@3.4.1,nextjs@auto,tailwind').stacks).toEqual({
      payload: '3.4.1',
      nextjs: 'auto',
      tailwind: 'auto',
    });
  });

  it('maps a trailing-@ (empty version) to "auto"', () => {
    expect(parseStacksCsv('payload@').stacks).toEqual({ payload: 'auto' });
  });

  it('trims whitespace around the token, name, and version', () => {
    expect(parseStacksCsv(' payload @ 3.4.1 , , nextjs ').stacks).toEqual({
      payload: '3.4.1',
      nextjs: 'auto',
    });
  });

  it('reports (does not silently drop) a token with no stack name', () => {
    const { stacks, skipped } = parseStacksCsv('@angular/core@1.2.3,nextjs@15');
    expect(stacks).toEqual({ nextjs: '15' });
    expect(skipped).toEqual(['@angular/core@1.2.3']);
  });

  it('keeps the last value on a duplicate name', () => {
    expect(parseStacksCsv('nextjs@15,nextjs@14').stacks).toEqual({ nextjs: '14' });
  });

  it('returns an empty map for empty input', () => {
    expect(parseStacksCsv('').stacks).toEqual({});
    expect(parseStacksCsv('  ,  ').stacks).toEqual({});
  });
});

describe('invalidStackVersions', () => {
  it('flags versions that are neither "auto" nor a valid semver range', () => {
    expect(
      invalidStackVersions({ payload: '3..4', nextjs: 'auto', react: '3.4.1', tailwind: '>=3' }),
    ).toEqual(['payload@3..4']);
  });

  it('returns nothing when every version is valid', () => {
    expect(invalidStackVersions({ payload: '3.4.1', nextjs: 'auto', vue: '*' })).toEqual([]);
  });
});
