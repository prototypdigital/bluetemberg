import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_PRESETS,
  MCP_SERVER_PRESETS,
  PACKAGE_MANAGERS,
  PLATFORM_CHOICES,
  RULE_COLLECTION_PRESETS,
  SKILL_PRESETS,
  TEAM_PROFILES,
} from './init/presets.js';
import { INIT_RULE_SOURCES } from './init/init-catalog.js';
import { SOURCE_TYPES } from './sources/types.js';

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
    ruleSource: [...INIT_RULE_SOURCES],
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
          long: '--rule-source <collections|none>',
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
        {
          long: '--sources <csv>',
          description:
            'External source specs (comma-separated, e.g. "github:owner/repo#HEAD:rules"). Written to llm/rule-sources.json.',
          requires: '--non-interactive without --config',
        },
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
        'ruleCollections',
        'includeAgents',
        'agents',
        'includeSkills',
        'skills',
        'includeMcp',
        'mcpServers',
        'externalSources',
      ],
    },
    source: {
      types: [...SOURCE_TYPES],
      specFormat: {
        github: 'github:<owner>/<repo>[#<ref>][:<path>]',
        prpm: 'prpm:<name>[@<range>]',
        'cursor-directory': 'cursor-directory:<slug>',
      },
      commands: [
        {
          name: 'add',
          args: '<spec>',
          description: 'Resolve, fetch, and pin an external source; writes manifest + lockfile.',
          options: [{ long: '--silent', description: 'Suppress all output.' }],
        },
        {
          name: 'remove',
          args: '<key>',
          description: 'Remove a source by key (as shown by "bluetemberg source list").',
          options: [{ long: '--silent', description: 'Suppress all output.' }],
        },
        {
          name: 'list',
          description: 'List configured external sources with their pinned refs.',
          options: [{ long: '--silent', description: 'Suppress all output.' }],
        },
        {
          name: 'install',
          description: 'Install all sources from the manifest (like npm ci).',
          options: [
            { long: '--force', description: 'Force re-download even if cached.' },
            { long: '--silent', description: 'Suppress all output.' },
          ],
        },
        {
          name: 'update',
          args: '[key]',
          description:
            'Re-resolve sources to the newest ref/version satisfying their spec. Updates all when key is omitted.',
          options: [{ long: '--silent', description: 'Suppress all output.' }],
        },
        {
          name: 'search',
          args: '<query>',
          description: 'Search backends that support discovery (prpm, cursor-directory).',
          options: [
            { long: '--type <type>', description: 'Restrict to one backend: prpm | cursor-directory.' },
            { long: '--limit <n>', description: 'Max results (default: 20).' },
            { long: '--silent', description: 'Suppress all output.' },
          ],
        },
      ],
    },
  };
}
