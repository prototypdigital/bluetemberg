import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preview } from '../src/preview/index.js';

function pack(name: string, kind: string, extra: Record<string, unknown> = {}): unknown {
  return {
    name,
    version: '0.1.0',
    description: name,
    kind,
    universal: false,
    profiles: ['backend'],
    preview: '',
    ...extra,
  };
}

describe('preview — platform routing (#281)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-preview-'));
    mkdirSync(join(root, '.bluetemberg'));
    // A fresh cache, so `loadCatalog` never reaches the network.
    writeFileSync(
      join(root, '.bluetemberg', 'catalog.json'),
      JSON.stringify({
        generated: new Date().toISOString(),
        packs: [
          pack('bluetemberg-agents-pr-reviewer', 'agents', { platforms: ['claude'] }),
          pack('bluetemberg-rules-git', 'rules', { platforms: [] }),
        ],
      }),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function run(options: Parameters<typeof preview>[2] = {}): Promise<string> {
    const lines: string[] = [];
    await preview(root, 'backend', { ...options, log: (m) => lines.push(m) });
    return lines.join('\n');
  }

  it('preselects a Claude Code–only pack for init’s default platforms', async () => {
    const out = await run();
    expect(out).toContain('Agents (1)');
    expect(out).not.toContain('Not preselected for these platforms');
    expect(out).toContain('`bluetemberg init --non-interactive --profile backend`');
  });

  it('lists it as not preselected for --platforms without claude, and carries the flag into the hint', async () => {
    const out = await run({ platforms: ['cursor', 'windsurf'] });
    expect(out).toContain('Platforms: cursor, devin');
    expect(out).not.toContain('Agents (1)');
    expect(out).toContain('bluetemberg-agents-pr-reviewer  [claude]');
    expect(out).toContain('Rules (1)');
    expect(out).toContain('--profile backend --platforms cursor,devin`');
  });

  it('defaults to the project config’s platforms when there is one', async () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['copilot'], source: 'llm' }),
    );
    const out = await run();
    expect(out).toContain('Platforms: copilot');
    expect(out).toContain('bluetemberg-agents-pr-reviewer  [claude]');
  });
});
