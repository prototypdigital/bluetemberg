import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinDefaultRanges } from '../src/registry/default-ranges.js';
import { DEFAULT_PACK_VERSION } from '../src/registry/manifest.js';

describe('pinDefaultRanges', () => {
  let root: string;

  const writePackages = (packages: Record<string, string>) => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'packages.json'), JSON.stringify({ packages }, null, 2) + '\n');
  };
  const readPackages = (): Record<string, string> =>
    (
      JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8')) as {
        packages: Record<string, string>;
      }
    ).packages;

  beforeEach(() => {
    root = join(tmpdir(), `bluetemberg-pin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('narrows the latest placeholder to ^<latest published version>', async () => {
    writePackages({ 'pack-a': DEFAULT_PACK_VERSION, 'pack-b': DEFAULT_PACK_VERSION });
    const versions: Record<string, string> = { 'pack-a': '0.3.2', 'pack-b': '1.0.3' };

    const result = await pinDefaultRanges(root, ['pack-a', 'pack-b'], async (name) => versions[name]);

    expect(result).toEqual({ pinned: ['pack-a', 'pack-b'], unresolved: [] });
    expect(readPackages()).toEqual({ 'pack-a': '^0.3.2', 'pack-b': '^1.0.3' });
  });

  it('leaves a range the user chose alone, and packs it was not asked about', async () => {
    writePackages({
      'pack-a': '~0.2.0',
      'pack-b': DEFAULT_PACK_VERSION,
      'pack-c': DEFAULT_PACK_VERSION,
    });
    const resolve = vi.fn(async () => '9.9.9');

    const result = await pinDefaultRanges(root, ['pack-a', 'pack-b'], resolve);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.pinned).toEqual(['pack-b']);
    expect(readPackages()).toEqual({
      'pack-a': '~0.2.0',
      'pack-b': '^9.9.9',
      'pack-c': DEFAULT_PACK_VERSION,
    });
  });

  it('keeps latest for a pack whose lookup fails or returns a non-version, and pins the rest', async () => {
    writePackages({ ok: DEFAULT_PACK_VERSION, offline: DEFAULT_PACK_VERSION, junk: DEFAULT_PACK_VERSION });
    const versions: Record<string, string | undefined> = {
      ok: '0.4.0',
      offline: undefined,
      junk: 'not-a-version',
    };

    const result = await pinDefaultRanges(root, ['ok', 'offline', 'junk'], async (name) => versions[name]);

    expect(result.pinned).toEqual(['ok']);
    expect(result.unresolved).toEqual(['offline', 'junk']);
    expect(readPackages()).toEqual({ ok: '^0.4.0', offline: 'latest', junk: 'latest' });
  });

  it('does not touch the manifest when nothing could be resolved', async () => {
    writePackages({ 'pack-a': DEFAULT_PACK_VERSION });
    const before = readFileSync(join(root, 'llm', 'packages.json'), 'utf8');

    await pinDefaultRanges(root, ['pack-a'], async () => undefined);

    expect(readFileSync(join(root, 'llm', 'packages.json'), 'utf8')).toBe(before);
  });
});
