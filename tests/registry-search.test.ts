import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { search } from '../src/registry/index.js';
import { searchPackages } from '../src/registry/client.js';

vi.mock('../src/registry/client.js', () => ({
  fetchPackageMetadata: vi.fn(),
  searchPackages: vi.fn(),
  downloadTarball: vi.fn(),
  verifyIntegrity: vi.fn(),
}));

const PACKS = [
  {
    name: 'bluetemberg-rules-nextjs',
    version: '0.5.0',
    description: 'Next.js rules',
    keywords: ['bluetemberg-pack', 'rules'],
  },
  {
    name: 'bluetemberg-rules-git',
    version: '0.2.2',
    description: 'Git workflow rules',
    keywords: ['bluetemberg-pack', 'rules'],
  },
  {
    name: 'bluetemberg-skills-code-review',
    version: '0.3.2',
    description: 'Structured code review',
    keywords: ['bluetemberg-pack', 'skills'],
  },
];

describe('search', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `bt-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    vi.mocked(searchPackages).mockResolvedValue(PACKS);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns nothing when the registry ignores an unmatched query and sends every pack back', async () => {
    const results = await search('zzzznotathing', { silent: true, root });
    expect(results).toEqual([]);
  });

  it('requires every term of the query, matched against name, description and keywords', async () => {
    expect((await search('nextjs rules', { silent: true, root })).map((p) => p.name)).toEqual([
      'bluetemberg-rules-nextjs',
    ]);
    expect((await search('REVIEW', { silent: true, root })).map((p) => p.name)).toEqual([
      'bluetemberg-skills-code-review',
    ]);
    expect((await search('skills', { silent: true, root })).map((p) => p.name)).toEqual([
      'bluetemberg-skills-code-review',
    ]);
  });

  it('keeps every pack the registry returned when they all match', async () => {
    expect(await search('bluetemberg', { silent: true, root })).toHaveLength(3);
  });
});
