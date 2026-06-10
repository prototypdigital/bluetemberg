import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create } from 'tar';

vi.mock('../src/registry/client.js', () => ({
  downloadTarball: vi.fn(),
}));

import { prpmAdapter } from '../src/sources/adapters/prpm.js';
import { downloadTarball } from '../src/registry/client.js';
import type { ResolvedSource } from '../src/sources/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-prpm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const originalFetch = globalThis.fetch;

/** Tarballs with no wrapper dir (PRPM layout): one structured skill, one flat rule. */
let skillTgz: string;
let flatRuleTgz: string;

beforeAll(async () => {
  const skillSrc = createTmpDir();
  mkdirSync(join(skillSrc, 'skills', 'using-superpowers'), { recursive: true });
  writeFileSync(
    join(skillSrc, 'skills', 'using-superpowers', 'SKILL.md'),
    '---\nname: using-superpowers\ndescription: Use superpowers\n---\n\nSkill body.\n',
  );
  writeFileSync(join(skillSrc, 'prpm.json'), '{"name":"@obra/skill-using-superpowers"}\n');
  writeFileSync(join(skillSrc, 'README.md'), '# Readme\n');
  skillTgz = join(createTmpDir(), 'skill.tgz');
  await create({ file: skillTgz, cwd: skillSrc, gzip: true }, ['skills', 'prpm.json', 'README.md']);

  const ruleSrc = createTmpDir();
  writeFileSync(
    join(ruleSrc, 'content.mdc'),
    '---\ndescription: A rule\nglobs: "**/*"\nalwaysApply: true\n---\n\nRule body.\n',
  );
  flatRuleTgz = join(createTmpDir(), 'rule.tgz');
  await create({ file: flatRuleTgz, cwd: ruleSrc, gzip: true }, ['content.mdc']);
});

function mockMetadata(body: object | string): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
  }) as typeof fetch;
}

describe('prpmAdapter.resolve', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves "latest" to the latest_version and carries subtype', async () => {
    mockMetadata({
      subtype: 'rule',
      latest_version: { version: '2.0.0' },
      versions: [
        { version: '1.0.0', tarball_url: 'https://prpm/v1.tgz' },
        { version: '2.0.0', tarball_url: 'https://prpm/v2.tgz' },
      ],
    });

    const resolved = await prpmAdapter.resolve({ type: 'prpm', name: 'foo', range: 'latest' });
    expect(resolved.ref).toBe('2.0.0');
    expect(resolved.resolved).toBe('https://prpm/v2.tgz');
    expect(resolved.subtype).toBe('rule');
    expect(resolved.key).toBe('prpm:foo');
  });

  it('resolves a semver range to the best matching version', async () => {
    mockMetadata({
      subtype: 'skill',
      latest_version: { version: '2.0.0' },
      versions: [
        { version: '1.2.0', tarball_url: 'https://prpm/v12.tgz' },
        { version: '2.0.0', tarball_url: 'https://prpm/v2.tgz' },
      ],
    });

    const resolved = await prpmAdapter.resolve({ type: 'prpm', name: 'foo', range: '^1.0.0' });
    expect(resolved.ref).toBe('1.2.0');
    expect(resolved.resolved).toBe('https://prpm/v12.tgz');
  });

  it('tolerates raw control characters in the metadata JSON', async () => {
    // A raw newline (U+000A) inside a string value — invalid JSON that PRPM emits.
    const dirty =
      '{"subtype":"rule","description":"line1\nline2","latest_version":{"version":"1.0.0"},"versions":[{"version":"1.0.0","tarball_url":"https://prpm/v1.tgz"}]}';
    mockMetadata(dirty);

    const resolved = await prpmAdapter.resolve({ type: 'prpm', name: 'foo', range: 'latest' });
    expect(resolved.ref).toBe('1.0.0');
  });

  it('throws when no version satisfies the range', async () => {
    mockMetadata({ subtype: 'rule', versions: [{ version: '1.0.0', tarball_url: 'x' }] });
    await expect(prpmAdapter.resolve({ type: 'prpm', name: 'foo', range: '^9.0.0' })).rejects.toThrow(
      'no version of "foo" satisfies',
    );
  });
});

describe('prpmAdapter.fetch — layout normalization', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.mocked(downloadTarball).mockReset();
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function resolved(name: string, subtype: ResolvedSource['subtype']): ResolvedSource {
    return {
      spec: { type: 'prpm', name, range: 'latest' },
      key: `prpm:${name}`,
      ref: '1.0.0',
      resolved: 'https://prpm/pkg.tgz',
      integrity: '',
      subtype,
    };
  }

  it('leaves a structured skill package as-is', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, dest: string) => {
      copyFileSync(skillTgz, dest);
      return 'sha512-skill';
    });

    const raw = await prpmAdapter.fetch(resolved('@obra/skill-using-superpowers', 'skill'), tmpDir);

    expect(raw.integrity).toBe('sha512-skill');
    expect(existsSync(join(tmpDir, 'skills', 'using-superpowers', 'SKILL.md'))).toBe(true);
  });

  it('normalizes a flat rule package into rules/<slug>', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, dest: string) => {
      copyFileSync(flatRuleTgz, dest);
      return 'sha512-rule';
    });

    const raw = await prpmAdapter.fetch(resolved('nextjs-rules', 'rule'), tmpDir);

    expect(raw.subtypeHint).toBe('rule');
    expect(existsSync(join(tmpDir, 'rules', 'nextjs-rules.mdc'))).toBe(true);
    expect(existsSync(join(tmpDir, 'content.mdc'))).toBe(false);
  });
});

describe('prpmAdapter.search', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps search results to installable specs', async () => {
    mockMetadata({
      packages: [
        { name: '@scope/react-rules', description: 'React', subtype: 'rule' },
        { name: 'plain-skill', subtype: 'skill' },
      ],
    });

    const results = await prpmAdapter.search!('react', {});
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      type: 'prpm',
      spec: 'prpm:@scope/react-rules',
      name: '@scope/react-rules',
      description: 'React',
      subtype: 'rule',
    });
    expect(results[1].spec).toBe('prpm:plain-skill');
  });
});
