import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('copies missing template files for the new profile', () => {
    scaffold(root, baseAnswers);

    const backendAgent = join(root, 'llm', 'agents', 'backend-specialist.md');
    expect(existsSync(backendAgent)).toBe(false);

    const result = switchProfile(root, 'backend', { silent: true });

    expect(existsSync(backendAgent)).toBe(true);
    expect(result.added).toContain(backendAgent);
  });

  it('does not overwrite existing agent files in llm/', () => {
    scaffold(root, baseAnswers);

    const frontendAgent = join(root, 'llm', 'agents', 'frontend-specialist.md');
    writeFileSync(frontendAgent, '# Custom override\n');

    switchProfile(root, 'fullstack', { silent: true });

    expect(readFileSync(frontendAgent, 'utf8')).toBe('# Custom override\n');
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
