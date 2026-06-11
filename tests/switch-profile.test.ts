import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/init/scaffold.js';
import { switchProfile } from '../src/init/switch-profile.js';
import type { InitAnswers } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-switch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const baseAnswers: InitAnswers = {
  teamProfile: 'frontend',
  projectName: 'My Project',
  projectDescription: 'A test project.',
  packageManager: 'npm',
  platforms: ['cursor', 'claude'],
  ruleSource: 'collections',
  rules: [],
  ruleCollections: ['typescript'],
  includeAgents: true,
  agents: ['frontend-specialist'],
  includeSkills: false,
  skills: [],
  includeMcp: false,
  mcpServers: [],
};

describe('switchProfile', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = createTmpDir();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('writes the new profile into bluetemberg.config.json', () => {
    scaffold(root, baseAnswers);

    switchProfile(root, 'backend', { silent: true });

    const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
    expect(config.profile).toBe('backend');
  });

  it('throws when no config exists', () => {
    expect(() => switchProfile(root, 'backend', { silent: true })).toThrow(/No bluetemberg\.config\.json/);
  });

  it('rejects an unknown profile id', () => {
    scaffold(root, baseAnswers);
    expect(() =>
      // @ts-expect-error testing invalid input
      switchProfile(root, 'not-a-profile', { silent: true }),
    ).toThrow(/Unknown profile/);
  });

  it('is a no-op when switching to the same profile', () => {
    scaffold(root, baseAnswers);

    const result = switchProfile(root, 'frontend', { silent: true });
    expect(result.added).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('adds missing agent packages to llm/packages.json when switching profile', () => {
    scaffold(root, baseAnswers);

    const result = switchProfile(root, 'backend', { silent: true });

    const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
    expect(manifest.packages['bluetemberg-agents-backend-specialist']).toBeDefined();
    expect(result.added).toContain('bluetemberg-agents-backend-specialist');
  });

  it('does not remove existing manifest entries when switching profile', () => {
    scaffold(root, baseAnswers);

    switchProfile(root, 'fullstack', { silent: true });

    const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
    expect(manifest.packages['bluetemberg-agents-frontend-specialist']).toBeDefined();
  });

  it('reports official packages outside the new profile defaults as stale', () => {
    scaffold(root, baseAnswers);

    const result = switchProfile(root, 'pure-infra', { silent: true });

    // frontend-specialist is not part of the pure-infra defaults.
    expect(result.stale).toContain('bluetemberg-agents-frontend-specialist');
    // Stale entries are reported, never removed.
    const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
    expect(manifest.packages['bluetemberg-agents-frontend-specialist']).toBeDefined();
  });

  it('never flags rule collections or third-party packs as stale', () => {
    scaffold(root, baseAnswers);

    const result = switchProfile(root, 'backend', { silent: true });

    expect(result.stale).not.toContain('bluetemberg-rules-typescript');
  });

  it('migrates legacy kind-split manifests into llm/packages.json', () => {
    scaffold(root, baseAnswers);
    writeFileSync(
      join(root, 'llm', 'agent-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-agents-sre-specialist': '^0.1.0' } }),
    );

    switchProfile(root, 'backend', { silent: true });

    const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
    expect(manifest.packages['bluetemberg-agents-sre-specialist']).toBe('^0.1.0');
    expect(existsSync(join(root, 'llm', 'agent-packages.json'))).toBe(false);
  });

  it('exposes the previous profile in the result', () => {
    scaffold(root, baseAnswers);

    const result = switchProfile(root, 'backend', { silent: true });
    expect(result.fromProfile).toBe('frontend');
    expect(result.toProfile).toBe('backend');
  });

  it('treats an unset previous profile as undefined', () => {
    scaffold(root, baseAnswers);
    const configPath = join(root, 'bluetemberg.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    delete config.profile;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = switchProfile(root, 'backend', { silent: true });
    expect(result.fromProfile).toBeUndefined();
    expect(result.toProfile).toBe('backend');
  });
});
