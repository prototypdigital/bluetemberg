import { describe, it, expect } from 'vitest';
import { resolveAdapterRun } from '../src/sync/adapters-runner.js';

describe('resolveAdapterRun', () => {
  it('accepts a default export function', () => {
    const fn = async () => {};
    expect(resolveAdapterRun(fn)).toBe(fn);
  });

  it('accepts a default object with run', () => {
    const run = async () => {};
    expect(resolveAdapterRun({ run })).toBe(run);
  });

  it('returns null for invalid exports', () => {
    expect(resolveAdapterRun(null)).toBeNull();
    expect(resolveAdapterRun({})).toBeNull();
    expect(resolveAdapterRun({ run: 'nope' })).toBeNull();
  });
});
