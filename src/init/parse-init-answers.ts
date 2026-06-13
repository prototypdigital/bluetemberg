import { readFileSync } from 'node:fs';

import type { InitAnswers, Platform, GitHubScaffoldConfig } from '../types.js';
import {
  INIT_PACKAGE_MANAGERS,
  INIT_PLATFORMS,
  INIT_RULE_SOURCES,
  INIT_TEAM_PROFILES,
} from './init-catalog.js';

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
  const allowedFlat = allowed as readonly string[];
  if (typeof val !== 'string' || !allowedFlat.includes(val)) {
    throw new Error(`Init answers invalid: "${field}" must be one of: ${allowed.join(', ')}.`);
  }
  // Safe: string is a member of `allowed` union (checked via includes against the same tuple).
  return val as V;
}

function expectPlatforms(record: Record<string, unknown>, field: string): Platform[] {
  const vals = expectStringArray(record, field);
  if (vals.length === 0) throw new Error('Init answers invalid: "platforms" must be a non-empty array.');
  const platformIds = INIT_PLATFORMS as readonly string[];
  for (const v of vals) {
    if (!platformIds.includes(v)) {
      throw new Error(`Init answers invalid: unknown platform "${v}".`);
    }
  }
  // Safe: each id was validated against `INIT_PLATFORMS`.
  return vals as Platform[];
}

function parseGithubConfig(val: unknown): GitHubScaffoldConfig | undefined {
  if (!isRecord(val)) return undefined;
  return {
    ci: expectBoolean(val, 'ci'),
    codeql: expectBoolean(val, 'codeql'),
    dependencyReview: expectBoolean(val, 'dependencyReview'),
    dependabot: expectBoolean(val, 'dependabot'),
    issueTemplates: expectBoolean(val, 'issueTemplates'),
    prTemplate: expectBoolean(val, 'prTemplate'),
    codeowners: expectBoolean(val, 'codeowners'),
    releaseWorkflow: expectBoolean(val, 'releaseWorkflow'),
    staleBot: expectBoolean(val, 'staleBot'),
    pagesWorkflow: expectBoolean(val, 'pagesWorkflow'),
    contributing: expectBoolean(val, 'contributing'),
    license: expectBoolean(val, 'license'),
    codeOfConduct: expectBoolean(val, 'codeOfConduct'),
    security: expectBoolean(val, 'security'),
    semanticPr: expectBoolean(val, 'semanticPr'),
    autoLabeler: expectBoolean(val, 'autoLabeler'),
    lockClosed: expectBoolean(val, 'lockClosed'),
  };
}

/** Parse and validate `--config` JSON into `InitAnswers`. */
export function assertInitAnswers(record: unknown): InitAnswers {
  if (!isRecord(record)) throw new Error('Init answers invalid: expected a JSON object.');

  return {
    teamProfile: expectEnum(record, 'teamProfile', INIT_TEAM_PROFILES),
    projectName: expectString(record, 'projectName'),
    projectDescription: expectString(record, 'projectDescription'),
    packageManager: expectEnum(record, 'packageManager', INIT_PACKAGE_MANAGERS),
    platforms: expectPlatforms(record, 'platforms'),
    ruleSource: expectEnum(record, 'ruleSource', INIT_RULE_SOURCES),
    rules: expectStringArray(record, 'rules'),
    ruleCollections: expectStringArray(record, 'ruleCollections'),
    includeAgents: expectBoolean(record, 'includeAgents'),
    agents: expectStringArray(record, 'agents'),
    includeSkills: expectBoolean(record, 'includeSkills'),
    skills: expectStringArray(record, 'skills'),
    includeMcp: expectBoolean(record, 'includeMcp'),
    mcpServers: expectStringArray(record, 'mcpServers'),
    marketplaceRemote: typeof record.marketplaceRemote === 'string' ? record.marketplaceRemote : '',
    marketplacePlugins: Array.isArray(record.marketplacePlugins)
      ? (record.marketplacePlugins as string[])
      : [],
    externalSources: Array.isArray(record.externalSources) ? (record.externalSources as string[]) : [],
    github: parseGithubConfig(record.github),
  };
}

/** Match wizard invariants: `collections` ↔ registry collections; `none` ↔ neither. */
export function normalizeInitAnswers(answers: InitAnswers): InitAnswers {
  if (answers.ruleSource === 'none') {
    return { ...answers, rules: [], ruleCollections: [] };
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
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Init config not found: ${absPath}`);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Init config could not be read: ${absPath} (${detail})`);
  }

  return parseInitAnswersJson(raw);
}
