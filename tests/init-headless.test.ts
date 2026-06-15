import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getMachineReadableHelp } from '../src/help-json.js';
import { init } from '../src/init/index.js';
import { finalizeNonInteractiveAnswers } from '../src/init/init-answers-from-profile.js';
import {
  assertInitAnswers,
  normalizeInitAnswers,
  parseInitAnswersJson,
  readInitAnswersFromFile,
} from '../src/init/parse-init-answers.js';
import type { InitAnswers } from '../src/types.js';

describe('parseInitAnswersJson', () => {
  const minimalCollections: Record<string, unknown> = {
    teamProfile: 'fullstack',
    projectName: 'p',
    projectDescription: 'd',
    packageManager: 'pnpm',
    platforms: ['claude'],
    ruleSource: 'collections',
    rules: [],
    ruleCollections: ['typescript'],
    includeAgents: false,
    agents: [],
    includeSkills: false,
    skills: [],
    includeMcp: false,
    mcpServers: [],
  };

  it('normalizes collections mode to drop template rules array', () => {
    const rec = { ...minimalCollections, rules: ['should-strip'] };
    const got = parseInitAnswersJson(JSON.stringify(rec));
    expect(got.rules).toEqual([]);
    expect(got.ruleSource).toBe('collections');
  });

  it('normalizes none mode to drop both rules and ruleCollections', () => {
    const rec = {
      ...minimalCollections,
      ruleSource: 'none',
      rules: ['should-strip'],
      ruleCollections: ['also-strip'],
    };
    const got = parseInitAnswersJson(JSON.stringify(rec));
    expect(got.rules).toEqual([]);
    expect(got.ruleCollections).toEqual([]);
    expect(got.ruleSource).toBe('none');
  });

  it('rejects unknown platform ids', () => {
    expect(() =>
      parseInitAnswersJson(JSON.stringify({ ...minimalCollections, platforms: ['unknown'] })),
    ).toThrow(/unknown platform/);
  });

  it('parses an optional stacks map', () => {
    const rec = { ...minimalCollections, stacks: { payload: '3.4.1', nextjs: 'auto' } };
    const got = parseInitAnswersJson(JSON.stringify(rec));
    expect(got.stacks).toEqual({ payload: '3.4.1', nextjs: 'auto' });
  });

  it('leaves stacks undefined when absent', () => {
    const got = parseInitAnswersJson(JSON.stringify(minimalCollections));
    expect(got.stacks).toBeUndefined();
  });

  it('rejects a stacks map with a non-string version', () => {
    const rec = { ...minimalCollections, stacks: { payload: 3 } };
    expect(() => parseInitAnswersJson(JSON.stringify(rec))).toThrow(/stacks\.payload/);
  });
});

describe('assertInitAnswers', () => {
  it('throws if record is not an object', () => {
    expect(() => assertInitAnswers(null)).toThrow(/expected a JSON object/);
  });
});

describe('readInitAnswersFromFile', () => {
  it('maps ENOENT to a clear error message', () => {
    expect(() =>
      readInitAnswersFromFile(
        join('/nonexistent-dir', `missing-${Math.random().toString(36).slice(2)}.json`),
      ),
    ).toThrow(/Init config not found:/);
  });
});

describe('normalizeInitAnswers explicit', () => {
  const base: InitAnswers = {
    teamProfile: 'custom',
    projectName: 'x',
    projectDescription: '',
    packageManager: 'npm',
    platforms: ['cursor'],
    ruleSource: 'collections',
    rules: [],
    ruleCollections: ['typescript'],
    includeAgents: true,
    agents: [],
    includeSkills: true,
    skills: [],
    includeMcp: false,
    mcpServers: [],
  };

  it('collections clears template rules array', () => {
    expect(normalizeInitAnswers({ ...base, rules: ['x'] }).rules).toEqual([]);
  });

  it('none clears both rules and collections', () => {
    const got = normalizeInitAnswers({ ...base, ruleSource: 'none', rules: ['x'] });
    expect(got.rules).toEqual([]);
    expect(got.ruleCollections).toEqual([]);
  });
});

describe('finalizeNonInteractiveAnswers', () => {
  it('baseline defaults to collections with profile-tagged packs for devops', () => {
    const dir = join('/tmp', 'bluetemberg-init-test-nonexistent-dir');
    const got = finalizeNonInteractiveAnswers('devops', dir, {});
    expect(got.packageManager).toBe('pnpm');
    // All non-marketplace platforms: cursor, claude, copilot, gemini, windsurf, codex.
    expect(got.platforms.length).toBe(6);
    expect(got.includeAgents).toBe(true);
    expect(got.ruleSource).toBe('collections');
    expect(got.ruleCollections.length).toBeGreaterThan(0);
  });

  it('respects ruleCollections override', () => {
    const got = finalizeNonInteractiveAnswers('frontend', join('/tmp', 'proj'), {
      ruleCollections: ['typescript'],
      packageManager: 'npm',
    });
    expect(got.packageManager).toBe('npm');
    expect(got.ruleCollections).toEqual(['typescript']);
  });

  it('omit agents via overrides', () => {
    const got = finalizeNonInteractiveAnswers('fullstack', join('/tmp', 'proj'), {
      includeAgents: false,
    });
    expect(got.agents).toEqual([]);
  });

  it('rule-source none yields empty rules and collections', () => {
    const got = finalizeNonInteractiveAnswers('fullstack', join('/tmp', 'proj'), {
      ruleSource: 'none',
    });
    expect(got.ruleSource).toBe('none');
    expect(got.rules).toEqual([]);
    expect(got.ruleCollections).toEqual([]);
  });

  it('threads a --stacks override through (baseline pins no stacks)', () => {
    const baseline = finalizeNonInteractiveAnswers('fullstack', join('/tmp', 'proj'), {});
    expect(baseline.stacks).toBeUndefined();

    const got = finalizeNonInteractiveAnswers('fullstack', join('/tmp', 'proj'), {
      stacks: { payload: '3.4.1', nextjs: 'auto' },
    });
    expect(got.stacks).toEqual({ payload: '3.4.1', nextjs: 'auto' });
  });
});

describe('InitRunOptions validation', () => {
  it('rejects conflicting configPath and nonInteractive', async () => {
    const root = join(tmpdir(), `bluetemberg-invalid-init-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });

    await expect(
      init(root, { nonInteractive: true, configPath: join(root, 'missing-init.json') }),
    ).rejects.toThrow(/configPath or nonInteractive/);
  });
});

describe('init headless orchestration', () => {
  it('runs without prompts using embedded answers only', async () => {
    const root = join(
      tmpdir(),
      `bluetemberg-init-headless-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(root, { recursive: true });

    await init(root, {
      answers: finalizeNonInteractiveAnswers('fullstack', root, {
        platforms: ['claude'],
        includeMcp: false,
      }),
    });

    expect(existsSync(join(root, 'bluetemberg.config.json'))).toBe(true);
  });
});

describe('getMachineReadableHelp', () => {
  it('lists catalog arrays for programmatic discovery', () => {
    const j = getMachineReadableHelp();
    expect(Array.isArray(j.teamProfiles)).toBe(true);
    expect(Array.isArray(j.ruleCollections)).toBe(true);
    expect(typeof j.cliVersion === 'string' && j.cliVersion.length > 0).toBe(true);
  });
});
