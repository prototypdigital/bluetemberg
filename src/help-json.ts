import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MCP_SERVER_PRESETS,
  PACKAGE_MANAGERS,
  PLATFORM_CHOICES,
  resolveAgents,
  resolveRuleCollections,
  resolveSkills,
  TEAM_PROFILES,
} from './init/presets.js';
import { loadCatalogSync } from './catalog/index.js';
import { INIT_RULE_SOURCES } from './init/init-catalog.js';
import { DEVIN_PLATFORM, LEGACY_DEVIN_PLATFORM } from './sync/targets.js';
import { SOURCE_TYPES } from './sources/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Options shared by the pack-downloading commands (`add`, `install`, `update`). */
const PACK_INSTALL_OPTIONS = [
  {
    long: '--skip-signature-verification',
    description: 'Allow unsigned packs from a non-default registry (ignored for npmjs.org).',
  },
  { long: '--skip-scan', description: 'Skip the content security scan (trusted private registries only).' },
  {
    long: '--allow-external-tarball-host',
    description:
      'Allow tarballs served from a host other than the configured registry (no credentials sent).',
  },
  { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
];

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
    // Former ids still accepted in config and `--platforms`, mapped to the id sync uses.
    platformAliases: { [LEGACY_DEVIN_PLATFORM]: DEVIN_PLATFORM },
    ruleSource: [...INIT_RULE_SOURCES],
    ruleCollections: resolveRuleCollections(catalog).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      packageName: c.packageName,
      tags: c.tags ?? [],
      // Platforms the pack is limited to (empty = every platform); see `catalog/platforms.ts`.
      platforms: c.platforms ?? [],
    })),
    agents: resolveAgents(catalog).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      platforms: a.platforms ?? [],
    })),
    skills: resolveSkills(catalog).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      platforms: s.platforms ?? [],
    })),
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
          description:
            "e.g. cursor,claude. Packs limited to other platforms (a pack's catalog `platforms`) are not preselected.",
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
        {
          long: '--omit-github',
          description: 'Skip the GitHub/community files (Dependabot, templates, CODEOWNERS, LICENSE, …).',
          requires: '--non-interactive without --config',
        },
        {
          long: '--force',
          description:
            'Overwrite existing AGENTS.md, CLAUDE.md, and GitHub files. By default init keeps them and lists what it kept.',
        },
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
        'github',
        'includeGuardrails',
        'guardrails',
        'marketplaceRemote',
        'marketplacePlugins',
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
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'coverage',
          args: '<stack>[@version] [directory]',
          description: 'Query whether version-correct guidance exists for a stack.',
          options: [
            { long: '--json', description: 'Emit machine-readable JSON.' },
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'stacks lint',
          args: '[directory]',
          description:
            '[maintainer] Flag open-ended stacks: ranges and ranges past the latest released major (project or packs repo). Exits 1 on findings.',
          options: [
            {
              long: '--offline',
              description: 'Do not query the npm registry; use cached latest versions only.',
            },
            {
              long: '--json',
              description: 'Emit machine-readable JSON (findings, latest, unchecked, warnings).',
            },
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'stacks list',
          args: '<stack>[@version|@range] [directory]',
          description:
            '[maintainer] List guidance declaring a range for a stack, narrowed to a version or range.',
          options: [
            {
              long: '--json',
              description: 'Emit machine-readable JSON (query, matches, nameLevel, warnings).',
            },
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'why',
          args: '[file] [directory]',
          description:
            'Explain why a rule, agent, skill or guardrail is included or excluded (file = source path, generated path, or id).',
          options: [
            {
              long: '--diff <stack@version>',
              description:
                'List what would be added/removed if the stack were at this version (repeatable; writes nothing).',
            },
            { long: '--json', description: 'Emit machine-readable JSON.' },
          ],
        },
        {
          name: 'scan-org',
          args: '[paths...]',
          description:
            '[maintainer] Histogram stack+version usage across N repos (local and/or remote) vs catalog coverage (read-only).',
          options: [
            {
              long: '--org <name>',
              description: '[remote] Scan every non-fork, non-archived repo in this GitHub org.',
            },
            { long: '--repos <list>', description: '[remote] Comma-separated owner/repo to scan.' },
            {
              long: '--since <days>',
              description: '[remote --org] Only scan repos pushed to within the last N days.',
            },
            { long: '--json', description: 'Emit machine-readable JSON (roots, histogram, gaps, skipped).' },
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
          note: 'A remote scan (--org/--repos) reads manifests over the GitHub API without cloning and requires a GITHUB_TOKEN or GH_TOKEN in the environment.',
        },
        {
          name: 'mcp serve',
          args: '[directory]',
          description: 'Serve the stack model as MCP tools over stdio (read-only).',
        },
      ],
      mcp: {
        transport: 'stdio',
        tools: [
          'bluetemberg_detect_stacks',
          'bluetemberg_query_coverage',
          'bluetemberg_list_stacks',
          'bluetemberg_why',
          'bluetemberg_org_histogram',
        ],
        note: 'Read-only. The gated scaffold_from_gap tool (M7 create-loop) is intentionally absent.',
      },
    },
    packs: {
      commands: [
        {
          name: 'add',
          args: '<packages...>',
          description: 'Resolve, verify, scan, and install packs; writes llm/packages.json + lockfile.',
          options: PACK_INSTALL_OPTIONS,
        },
        {
          name: 'install',
          description: 'Install all packs from llm/packages.json (like npm ci).',
          options: [
            { long: '--force', description: 'Force re-download even if cached.' },
            {
              long: '--dry-run',
              description: 'Resolve packs and print the install plan without writing files.',
            },
            ...PACK_INSTALL_OPTIONS,
          ],
        },
        {
          name: 'update',
          args: '[package]',
          description: 'Update packs to the newest version satisfying their manifest range.',
          options: [
            { long: '--latest', description: 'Widen ranges to "latest" in the manifest.' },
            ...PACK_INSTALL_OPTIONS,
          ],
        },
      ],
      contentScan: {
        description:
          'Every freshly downloaded pack is scanned before it lands in the cache. Blocking findings abort the install; warnings are reported.',
        blocks: [
          'real-looking credentials',
          'secrets in the body of a request to a non-local host',
          'decode-to-shell pipelines',
          'instructions to disable hooks/guardrails/verification',
          'dangerous agent flags',
          'prompt-override phrases',
          'bidi control characters',
          'curl | sh in hooks.json/mcp.json',
          'packs shipping reserved engine marker files',
        ],
        warns: [
          'rm -rf',
          'curl | sh',
          'writes to secrets files',
          '--no-verify',
          'mentions of verification-weakening switches',
          'scripts that read secrets and upload on separate lines',
          'blocking patterns quoted in BAD-labelled markdown examples',
        ],
      },
    },
    managedSettings: {
      command: 'managed-settings',
      args: '[directory]',
      description:
        'Write org policy files for Claude Code and GitHub Copilot that register the configured marketplace (marketplace.remote) and force-enable its plugins. Admins deploy them; sync never writes them.',
      requires: 'marketplace.remote, plus a synced .claude-plugin/marketplace.json',
      outputs: ['claude-code/managed-settings.json', 'github-copilot/managed-settings.json', 'README.md'],
      refusesToWrite: [
        'outside --out',
        'a live host policy path',
        '~/.claude',
        'through a symlink',
        'over a file it did not generate',
      ],
      options: [
        {
          long: '--host <claude|copilot|all>',
          description:
            'Hosts to write for. Default: claude with claude-marketplace, copilot with agent-plugins.',
        },
        {
          long: '--out <dir>',
          description: 'Output directory, relative to the current directory (default managed-settings).',
        },
        {
          long: '--ref <ref>',
          description:
            'Pin the marketplace source to a git tag or branch. A commit SHA is accepted for Copilot only.',
        },
        { long: '--auto-update', description: 'Set autoUpdate: true on the marketplace entry.' },
        { long: '--plugin <name>', description: 'Force-enable only this plugin (repeatable).' },
        {
          long: '--strict',
          description: 'Also write strictKnownMarketplaces, which blocks every marketplace not listed.',
        },
        {
          long: '--allow-marketplace <owner/repo>',
          description: 'With --strict, keep another GitHub marketplace allowed (repeatable).',
        },
        {
          long: '--mcp-allowlist',
          description:
            'Also write allowedMcpServers listing exactly the servers in <source>/mcp.json (llm/ by default) and the root .mcp.json.',
        },
        {
          long: '--telemetry-endpoint <url>',
          description:
            "Opt in to OpenTelemetry export: point each host's own exporter at this OTLP collector (Claude Code env, Copilot telemetry). Content capture is written off; bluetemberg sends nothing itself. Refuses URLs with credentials or a query string.",
        },
        {
          long: '--telemetry-protocol <http/protobuf|http/json|grpc>',
          description: 'OTLP protocol (default http/protobuf). grpc is Claude Code only.',
        },
        {
          long: '--telemetry-attribute <key=value>',
          description:
            'Extra resource attribute next to bluetemberg.marketplace and bluetemberg.packs.digest (repeatable). Keys under bluetemberg. or that look like credentials are refused.',
        },
        { long: '--dry-run', description: 'Print the files instead of writing them.' },
        { long: '--json', description: 'Emit the plan, files included, as JSON.' },
        {
          long: '--silent',
          description: 'Suppress progress output; errors and warnings still go to stderr.',
        },
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
          options: [
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'remove',
          args: '<key>',
          description: 'Remove a source by key (as shown by "bluetemberg source list").',
          options: [
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'list',
          description: 'List configured external sources with their pinned refs.',
          options: [
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'install',
          description: 'Install all sources from the manifest (like npm ci).',
          options: [
            { long: '--force', description: 'Force re-download even if cached.' },
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'update',
          args: '[key]',
          description:
            'Re-resolve sources to the newest ref/version satisfying their spec. Updates all when key is omitted.',
          options: [
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
        {
          name: 'search',
          args: '<query>',
          description: 'Search backends that support discovery (prpm, cursor-directory).',
          options: [
            { long: '--type <type>', description: 'Restrict to one backend: prpm | cursor-directory.' },
            { long: '--limit <n>', description: 'Max results (default: 20).' },
            { long: '--silent', description: 'Suppress progress output; errors still go to stderr.' },
          ],
        },
      ],
    },
  };
}
