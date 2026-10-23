import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import { hasGeneratedBanner } from '../src/sync/banner.js';
import type { BlueprintConfig } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-skill-files-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const claude: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
const SCRIPT = '#!/usr/bin/env bash\necho "checking"\n';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

/** A skill with a script, a reference doc, a nested asset and a dotfile. */
function writeSkill(root: string, name = 'checker'): string {
  const dir = join(root, 'llm', 'skills', name);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'references', 'deep'), { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Runs scripts/check.sh\n---\n\n# ${name}\n`,
  );
  writeFileSync(join(dir, 'scripts', 'check.sh'), SCRIPT);
  chmodSync(join(dir, 'scripts', 'check.sh'), 0o755);
  writeFileSync(join(dir, 'references', 'notes.md'), '# notes\n');
  writeFileSync(join(dir, 'references', 'deep', 'logo.png'), PNG);
  writeFileSync(join(dir, '.DS_Store'), 'junk');
  return dir;
}

async function syncCapturing(root: string, options: Parameters<typeof sync>[1]) {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(' '));
  try {
    return { results: await sync(root, options), logs };
  } finally {
    console.log = orig;
  }
}

describe('skill supporting files', () => {
  let root: string;
  const out = (...rel: string[]) => join(root, '.claude', 'skills', 'checker', ...rel);

  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('copies scripts, references and nested assets byte for byte, keeping the mode', async () => {
    writeSkill(root);

    await sync(root, { config: claude, silent: true });

    expect(readFileSync(out('scripts', 'check.sh'), 'utf8')).toBe(SCRIPT);
    expect(statSync(out('scripts', 'check.sh')).mode & 0o111).not.toBe(0);
    expect(readFileSync(out('references', 'notes.md'), 'utf8')).toBe('# notes\n');
    expect(hasGeneratedBanner(readFileSync(out('references', 'notes.md'), 'utf8'))).toBe(false);
    expect(readFileSync(out('references', 'deep', 'logo.png')).equals(PNG)).toBe(true);
    expect(hasGeneratedBanner(readFileSync(out('SKILL.md'), 'utf8'))).toBe(true);
  });

  it('skips dotfiles', async () => {
    writeSkill(root);
    await sync(root, { config: claude, silent: true });
    expect(existsSync(out('.DS_Store'))).toBe(false);
  });

  it('counts each supporting file as written', async () => {
    writeSkill(root);
    const results = await sync(root, { config: claude, silent: true });
    // SKILL.md + check.sh + notes.md + logo.png
    expect(results.synced).toBe(4);
  });

  it('reports a changed script as out of sync, byte for byte, without writing', async () => {
    writeSkill(root);
    await sync(root, { config: claude, silent: true });
    writeFileSync(out('scripts', 'check.sh'), SCRIPT + 'echo tampered\n');

    const { results, logs } = await syncCapturing(root, { config: claude, check: true });

    expect(results.outOfSync).toBe(1);
    expect(logs.some((l) => l.includes('OUT OF SYNC') && l.includes(join('scripts', 'check.sh')))).toBe(true);
    expect(readFileSync(out('scripts', 'check.sh'), 'utf8')).toBe(SCRIPT + 'echo tampered\n');
  });

  it('is clean in check mode right after a sync', async () => {
    writeSkill(root);
    await sync(root, { config: claude, silent: true });
    const results = await sync(root, { config: claude, check: true, silent: true });
    expect(results.outOfSync).toBe(0);
  });

  it('reports a supporting file the source no longer has as STALE, and prune removes it', async () => {
    const dir = writeSkill(root);
    await sync(root, { config: claude, silent: true });
    rmSync(join(dir, 'references', 'notes.md'));

    const { results, logs } = await syncCapturing(root, { config: claude, check: true });
    expect(results.stale).toBe(1);
    expect(logs.some((l) => l.includes('STALE:') && l.includes(join('references', 'notes.md')))).toBe(true);

    await sync(root, { config: claude, prune: true, silent: true });
    expect(existsSync(out('references', 'notes.md'))).toBe(false);
    expect(existsSync(out('scripts', 'check.sh'))).toBe(true);
  });

  it('removes the whole skill directory, scripts included, once the skill is gone', async () => {
    const dir = writeSkill(root);
    await sync(root, { config: claude, silent: true });
    rmSync(dir, { recursive: true });

    await sync(root, { config: claude, prune: true, silent: true });

    expect(existsSync(join(root, '.claude', 'skills', 'checker'))).toBe(false);
  });

  it('leaves a hand-written skill directory alone, scripts and all', async () => {
    writeSkill(root);
    mkdirSync(join(root, '.claude', 'skills', 'mine', 'scripts'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n\n# mine\n');
    writeFileSync(join(root, '.claude', 'skills', 'mine', 'scripts', 'go.sh'), 'echo go\n');

    const { results } = await syncCapturing(root, { config: claude, check: true, silent: true });
    expect(results.stale).toBe(0);

    await sync(root, { config: claude, prune: true, silent: true });
    expect(existsSync(join(root, '.claude', 'skills', 'mine', 'scripts', 'go.sh'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md'))).toBe(true);
  });

  it('copies supporting files into marketplace plugin skills too', async () => {
    writeSkill(root);
    const config: BlueprintConfig = {
      platforms: ['claude', 'claude-marketplace'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });

    const plugin = join(root, 'plugins', basename(root), 'skills', 'checker');
    expect(readFileSync(join(plugin, 'scripts', 'check.sh'), 'utf8')).toBe(SCRIPT);
    expect(statSync(join(plugin, 'scripts', 'check.sh')).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(plugin, 'references', 'deep', 'logo.png')).equals(PNG)).toBe(true);
  });
});
