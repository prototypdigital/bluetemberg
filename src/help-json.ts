import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_OVERLAYS,
  MCP_SERVER_PRESETS,
  PACKAGE_MANAGERS,
  PLATFORM_CHOICES,
  resolveRuleCollections,
  SKILL_OVERLAYS,
  TEAM_PROFILES,
} from './init/presets.js';
import { loadCatalogSync } from './catalog/index.js';
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
  const catalog = loadCatalogSync(process.cwd());
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
    ruleCollections: resolveRuleCollections(catalog).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      packageName: c.packageName,
      tags: c.tags ?? [],
    })),
    agents: AGENT_OVERLAYS.map((a) => ({ id: a.id, name: a.name, description: a.description })),
    skills: SKILL_OVERLAYS.map((s) => ({ id: s.id, name: s.name, description: s.description })),
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
        {
          long: '--stacks <csv>',
          description:
            'Technology stacks to manage, written to config "stacks" (e.g. "payload@3.4.1,nextjs@auto"; bare name → "auto").',
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
        'stacks',
      ],
    },
    stacks: {
      description:
        'Version-aware technology axis, orthogonal to profiles. A rule/guardrail `stacks:` constraint ' +
        '(e.g. {"payload":">=3 <4"}) is applied at sync only when every named stack is present and its ' +
        'detected version satisfies the range; otherwise it is hard-excluded.',
      configField: {
        key: 'stacks',
        shape: 'Record<stackName, semverRange | exactVersion | "auto">',
        note: 'A pinned version is matched directly; "auto" re-detects every sync. Drives RULE routing — `llm/` stays the source of truth.',
      },
      detection: {
        layers: ['declared (config)', 'node_modules', 'package-lock.json', 'coerced package.json range'],
        confidence: ['declared', 'exact', 'coerced', 'unknown'],
        semantics: [
          'hard-exclude on no match',
          'warn (never silently drop) on low confidence',
          'most-specific-range wins',
        ],
      },
      commands: [
        {
          name: 'detect',
          args: '[directory]',
          description: 'Detect stacks + versions and report coverage/gaps.',
          options: [
            { long: '--json', description: 'Emit machine-readable JSON (detected, gaps, warnings).' },
            { long: '--silent', description: 'Suppress all output.' },
          ],
        },
        {
          name: 'coverage',
          args: '<stack>[@version] [directory]',
          description: 'Query whether version-correct guidance exists for a stack.',
          options: [
            { long: '--json', description: 'Emit machine-readable JSON.' },
            { long: '--silent', description: 'Suppress all output.' },
          ],
        },
        {
          name: 'mcp serve',
          args: '[directory]',
          description: 'Serve the stack model as MCP tools over stdio (read-only).',
        },
      ],
      mcp: {
        transport: 'stdio',
        tools: ['bluetemberg_detect_stacks', 'bluetemberg_query_coverage', 'bluetemberg_list_stacks'],
        note: 'Read-only. The gated scaffold_from_gap tool (M7 create-loop) is intentionally absent.',
      },
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
