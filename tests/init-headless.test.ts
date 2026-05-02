import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getMachineReadableHelp } from '../src/help-json.js';
import { init } from '../src/init/index.js';
import {
  finalizeNonInteractiveAnswers,
  universalRulesForProfile,
} from '../src/init/init-answers-from-profile.js';
import {
  assertInitAnswers,
  normalizeInitAnswers,
  parseInitAnswersJson,
} from '../src/init/parse-init-answers.js';
import type { InitAnswers } from '../src/types.js';

describe('parseInitAnswersJson', () => {
  const minimalTemplates: Record<string, unknown> = {
    teamProfile: 'fullstack',
    projectName: 'p',
    projectDescription: 'd',
    packageManager: 'pnpm',
    platforms: ['claude'],
    ruleSource: 'templates',
    rules: [],
    ruleCollections: ['noise'],
    includeAgents: false,
    agents: [],
    includeSkills: false,
    skills: [],
    includeMcp: false,
    mcpServers: [],
  };

  it('normalizes templates mode to drop ruleCollections', () => {
    const got = parseInitAnswersJson(JSON.stringify(minimalTemplates));
    expect(got.ruleCollections).toEqual([]);
    expect(got.ruleSource).toBe('templates');
  });

  it('normalizes collections mode to drop template rules array', () => {
    const rec = {
      ...minimalTemplates,
      ruleSource: 'collections',
      rules: ['should-strip'],
      ruleCollections: [],
    };
    const got = parseInitAnswersJson(JSON.stringify(rec));
    expect(got.rules).toEqual([]);
    expect(got.ruleSource).toBe('collections');
  });

  it('rejects unknown platform ids', () => {
    expect(() =>
      parseInitAnswersJson(
        JSON.stringify({ ...minimalTemplates, platforms: ['unknown'], ruleCollections: [] }),
      ),
    ).toThrow(/unknown platform/);
  });
});

describe('assertInitAnswers', () => {
  it('throws if record is not an object', () => {
    expect(() => assertInitAnswers(null)).toThrow(/expected a JSON object/);
  });
});

describe('normalizeInitAnswers explicit', () => {
  const base: InitAnswers = {
    teamProfile: 'custom',
    projectName: 'x',
    projectDescription: '',
    packageManager: 'npm',
    platforms: ['cursor'],
    ruleSource: 'templates',
    rules: [],
    ruleCollections: ['typescript'],
    includeAgents: true,
    agents: [],
    includeSkills: true,
    skills: [],
    includeMcp: false,
    mcpServers: [],
  };

  it('templates clears collections', () => {
    expect(normalizeInitAnswers(base).ruleCollections).toEqual([]);
  });
});

describe('finalizeNonInteractiveAnswers', () => {
  it('baseline matches profile presets for devops', () => {
    const dir = join('/tmp', 'bluetemberg-init-test-nonexistent-dir');
    const got = finalizeNonInteractiveAnswers('devops', dir, {});
    expect(got.packageManager).toBe('pnpm');
    expect(got.platforms.length).toBe(4);
    expect(got.includeAgents).toBe(true);
    expect(universalRulesForProfile('devops').every((id) => got.rules.includes(id))).toBe(true);
  });

  it('accepts shallow overrides without wiping universal rules when rules are provided', () => {
    const got = finalizeNonInteractiveAnswers('frontend', join('/tmp', 'proj'), {
      rules: ['design-system-reuse'],
      packageManager: 'npm',
    });
    expect(got.packageManager).toBe('npm');
    const u = universalRulesForProfile('frontend');
    expect(u.every((id) => got.rules.includes(id))).toBe(true);
    expect(got.rules).toContain('design-system-reuse');
  });

  it('omit agents via overrides', () => {
    const got = finalizeNonInteractiveAnswers('fullstack', join('/tmp', 'proj'), {
      includeAgents: false,
    });
    expect(got.agents).toEqual([]);
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
    expect(Array.isArray(j.rules)).toBe(true);
    expect(typeof j.cliVersion === 'string' && j.cliVersion.length > 0).toBe(true);
  });
});
