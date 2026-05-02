import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_PRESETS,
  MCP_SERVER_PRESETS,
  PACKAGE_MANAGERS,
  PLATFORM_CHOICES,
  RULE_COLLECTION_PRESETS,
  RULE_PRESETS,
  SKILL_PRESETS,
  TEAM_PROFILES,
} from './init/presets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readCliVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Canonical catalog + init flags for programmatic discovery (`bluetemberg --help --json`).
 * Shape is semver-stable-ish: additive fields preferred.
 */
export function getMachineReadableHelp(): Record<string, unknown> {
  return {
    cliVersion: readCliVersion(),
    teamProfiles: TEAM_PROFILES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
    })),
    packageManagers: PACKAGE_MANAGERS.map((p) => p.id),
    platforms: PLATFORM_CHOICES.map((p) => ({ id: p.id, name: p.name })),
    ruleSource: ['templates', 'collections'],
    rules: RULE_PRESETS.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      universal: Boolean(r.universal),
    })),
    ruleCollections: RULE_COLLECTION_PRESETS.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      packageName: c.packageName,
      tags: c.tags ?? [],
    })),
    agents: AGENT_PRESETS.map((a) => ({ id: a.id, name: a.name, description: a.description })),
    skills: SKILL_PRESETS.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    mcpServers: MCP_SERVER_PRESETS.map((m) => ({ id: m.id, name: m.name, description: m.description })),
    init: {
      options: [
        { long: '--non-interactive', description: 'Use profile defaults plus optional overrides (no TTY).' },
        {
          long: '--silent',
          description: 'Suppress progress and success messages (still check exit status).',
          requires: '`--non-interactive` or `--config`',
        },
        {
          long: '--config <file>',
          description: 'Apply InitAnswers JSON from disk (exclusive with init overrides).',
        },
        {
          long: '--profile <id>',
          description: `Team profile (default ${'fullstack'})`,
          requires: '--non-interactive',
        },
        { long: '--project-name <name>', requires: '--non-interactive without --config' },
        { long: '--project-description <text>', requires: '--non-interactive without --config' },
        { long: '--package-manager <pnpm|npm|yarn>', requires: '--non-interactive without --config' },
        {
          long: '--platforms <csv>',
          description: 'e.g. cursor,claude',
          requires: '--non-interactive without --config',
        },
        {
          long: '--rule-source <templates|collections>',
          requires: '--non-interactive without --config',
        },
        {
          long: '--rules <csv>',
          description: 'Template rule ids (universal rules are always appended).',
          requires: '--non-interactive without --config',
        },
        {
          long: '--rule-collections <csv>',
          description: 'When rule-source is collections.',
          requires: '--non-interactive without --config',
        },
        { long: '--agents <csv>', requires: '--non-interactive without --config' },
        { long: '--skills <csv>', requires: '--non-interactive without --config' },
        { long: '--mcp-servers <csv>', requires: '--non-interactive without --config' },
        { long: '--omit-agents', requires: '--non-interactive without --config' },
        { long: '--omit-skills', requires: '--non-interactive without --config' },
        { long: '--omit-mcp', requires: '--non-interactive without --config' },
      ],
      initAnswersFields: [
        'teamProfile',
        'projectName',
        'projectDescription',
        'packageManager',
        'platforms',
        'ruleSource',
        'rules',
        'ruleCollections',
        'includeAgents',
        'agents',
        'includeSkills',
        'skills',
        'includeMcp',
        'mcpServers',
      ],
    },
  };
}
