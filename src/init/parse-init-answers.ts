import { readFileSync } from 'node:fs';

import type { InitAnswers, PackageManager, Platform, RuleSource, TeamProfile } from '../types.js';

const TEAM_PROFILES: readonly TeamProfile[] = [
  'frontend',
  'backend',
  'fullstack',
  'devops',
  'pure-infra',
  'custom',
];

const PACKAGE_MANAGERS: readonly PackageManager[] = ['pnpm', 'npm', 'yarn'];

const PLATFORMS: readonly Platform[] = ['cursor', 'claude', 'copilot', 'gemini'];

const RULE_SOURCES: readonly RuleSource[] = ['templates', 'collections'];

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function missingField(field: string): Error {
  return new Error(`Init answers invalid: missing or invalid "${field}".`);
}

function expectString(record: Record<string, unknown>, field: string): string {
  const val = record[field];
  if (typeof val !== 'string') throw missingField(field);
  return val;
}

function expectStringArray(record: Record<string, unknown>, field: string): string[] {
  const val = record[field];
  if (!Array.isArray(val) || val.some((x) => typeof x !== 'string')) {
    throw missingField(field);
  }
  return val;
}

function expectBoolean(record: Record<string, unknown>, field: string): boolean {
  const val = record[field];
  if (typeof val !== 'boolean') throw missingField(field);
  return val;
}

function expectEnum<V extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly V[],
): V {
  const val = record[field];
  if (typeof val !== 'string' || !(allowed as readonly string[]).includes(val)) {
    throw new Error(`Init answers invalid: "${field}" must be one of: ${allowed.join(', ')}.`);
  }
  return val as V;
}

function expectPlatforms(record: Record<string, unknown>, field: string): Platform[] {
  const vals = expectStringArray(record, field);
  if (vals.length === 0) throw new Error('Init answers invalid: "platforms" must be a non-empty array.');
  for (const v of vals) {
    if (!(PLATFORMS as readonly string[]).includes(v)) {
      throw new Error(`Init answers invalid: unknown platform "${v}".`);
    }
  }
  return vals as Platform[];
}

/** Parse and validate `--config` JSON into `InitAnswers`. */
export function assertInitAnswers(record: unknown): InitAnswers {
  if (!isRecord(record)) throw new Error('Init answers invalid: expected a JSON object.');

  return {
    teamProfile: expectEnum(record, 'teamProfile', TEAM_PROFILES),
    projectName: expectString(record, 'projectName'),
    projectDescription: expectString(record, 'projectDescription'),
    packageManager: expectEnum(record, 'packageManager', PACKAGE_MANAGERS),
    platforms: expectPlatforms(record, 'platforms'),
    ruleSource: expectEnum(record, 'ruleSource', RULE_SOURCES),
    rules: expectStringArray(record, 'rules'),
    ruleCollections: expectStringArray(record, 'ruleCollections'),
    includeAgents: expectBoolean(record, 'includeAgents'),
    agents: expectStringArray(record, 'agents'),
    includeSkills: expectBoolean(record, 'includeSkills'),
    skills: expectStringArray(record, 'skills'),
    includeMcp: expectBoolean(record, 'includeMcp'),
    mcpServers: expectStringArray(record, 'mcpServers'),
  };
}

/** Match wizard invariants: `templates` ↔ local rules only; `collections` ↔ registry collections only. */
export function normalizeInitAnswers(answers: InitAnswers): InitAnswers {
  if (answers.ruleSource === 'templates') {
    return { ...answers, ruleCollections: [] };
  }
  return { ...answers, rules: [] };
}

export function parseInitAnswersJson(text: string): InitAnswers {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Init answers invalid: JSON could not be parsed.');
  }

  return normalizeInitAnswers(assertInitAnswers(parsed));
}

export function readInitAnswersFromFile(absPath: string): InitAnswers {
  const raw = readFileSync(absPath, 'utf8');
  return parseInitAnswersJson(raw);
}
