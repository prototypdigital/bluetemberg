import type { PackageManager, Platform, RuleSource, TeamProfile } from '../types.js';

/**
 * Canonical allowed values for `InitAnswers` and CLI `--non-interactive` / `--config` validation.
 * Keep in sync with `TeamProfile`, `Platform`, etc. in `types.ts`.
 */
export const INIT_TEAM_PROFILES: readonly TeamProfile[] = [
  'frontend',
  'backend',
  'fullstack',
  'devops',
  'pure-infra',
  'custom',
];

export const INIT_PACKAGE_MANAGERS: readonly PackageManager[] = ['pnpm', 'npm', 'yarn'];

export const INIT_PLATFORMS: readonly Platform[] = [
  'cursor',
  'claude',
  'copilot',
  'gemini',
  'windsurf',
  'claude-marketplace',
];

export const INIT_RULE_SOURCES: readonly RuleSource[] = ['templates', 'collections'];
