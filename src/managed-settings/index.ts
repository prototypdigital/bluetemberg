import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { McpServerConfig } from '../mcp/registry.js';
import {
  CLAUDE_OFFICIAL_MARKETPLACE,
  HOST_FACTS,
  MANAGED_SETTINGS_HOSTS,
  type ManagedSettingsHost,
} from './hosts.js';
import { OWNER_REPO_RE, readProjectInputs, type PackPin, type ProjectInputs } from './inputs.js';
import { renderReadme } from './readme.js';

export { HOST_FACTS, MANAGED_SETTINGS_HOSTS, type ManagedSettingsHost } from './hosts.js';

/**
 * `bluetemberg managed-settings`: org policy files for Claude Code and GitHub Copilot, derived from
 * the project's config, its generated marketplace index and its pack lockfile. Admins deploy the
 * files themselves (MDM, file push, or Copilot's `.github-private` repo). Sync never writes them,
 * and nothing here reads or writes a host's real settings paths: files land under `--out` only.
 */
export interface ManagedSettingsOptions {
  /** `claude`, `copilot` or `all`. Default: the hosts the project's bundle platforms serve. */
  host?: ManagedSettingsHost | 'all';
  /** Git branch or tag (Copilot also takes a commit SHA) to pin the marketplace source to. */
  ref?: string;
  /** Also write `strictKnownMarketplaces`, which blocks every marketplace not listed. */
  strict?: boolean;
  /** Extra `owner/repo` marketplaces to keep allowed under `strict`. */
  allowMarketplaces?: string[];
  /** Set `autoUpdate: true` on the marketplace entry. */
  autoUpdate?: boolean;
  /** Plugins to force-enable (default: every plugin the marketplace publishes). */
  plugins?: string[];
  /** Also write `allowedMcpServers` listing exactly the project's `llm/mcp.json` servers. */
  mcpAllowlist?: boolean;
}

export interface ManagedSettingsFile {
  /** Relative to the output dir, `/`-separated. */
  path: string;
  /** Host the file is for; absent for the README. */
  host?: ManagedSettingsHost;
  content: string;
}

export interface ManagedSettingsPlan {
  hosts: ManagedSettingsHost[];
  marketplace: { name: string; repo: string; ref?: string; autoUpdate: boolean };
  plugins: string[];
  strict: boolean;
  allowedMarketplaces: string[];
  /** `llm/mcp.json` server ids in `allowedMcpServers`; empty without `mcpAllowlist`. */
  mcpServers: string[];
  /** Pack versions the published bundles were built from (bundle locks, else the lockfile). */
  packs: Record<string, PackPin>;
  files: ManagedSettingsFile[];
  warnings: string[];
}

type McpMatcher = { serverCommand: string[] } | { serverUrl: string };

interface McpAllowlist {
  ids: string[];
  matchers: McpMatcher[];
  warnings: string[];
}

/** A full commit SHA (SHA-1 or SHA-256 object names). A shorter hex string may be a tag. */
const FULL_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
/** Conservative git ref name: no spaces, no leading `-` or `/`, no `..`. */
const REF_RE = /^(?!-)(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

export function planManagedSettings(root: string, options: ManagedSettingsOptions = {}): ManagedSettingsPlan {
  const inputs = readProjectInputs(root);
  const hosts = resolveHosts(options.host, inputs);
  validateRef(options.ref, hosts);
  const allowedMarketplaces = validateAllowMarketplaces(options);
  const plugins = selectPlugins(options.plugins, inputs);
  checkConfigMatchesIndex(inputs);
  checkBundlesMatchLockfile(inputs);

  const mcp: McpAllowlist = options.mcpAllowlist
    ? mcpAllowlist(inputs)
    : { ids: [], matchers: [], warnings: [] };
  const warnings: string[] = [...mcp.warnings, ...unbundledPackWarnings(inputs)];
  if (inputs.bundleLocks.length === 0) {
    warnings.push(
      'No Agent Plugins bundle locks found, so the published bundles could not be checked against ' +
        'packages-lock.json. Add "agent-plugins" to platforms to get one per bundle.',
    );
  }
  if (inputs.marketplace.name !== basename(root)) {
    warnings.push(
      `The marketplace index is named "${inputs.marketplace.name}" but this folder is "${basename(root)}"; ` +
        'sync names the marketplace after the folder it runs in. The policy uses the index name, so ' +
        'make sure the published marketplace.json carries the same one.',
    );
  }

  const base: Omit<ManagedSettingsPlan, 'files'> = {
    hosts,
    marketplace: {
      name: inputs.marketplace.name,
      repo: inputs.remote,
      ...(options.ref ? { ref: options.ref } : {}),
      autoUpdate: options.autoUpdate === true,
    },
    plugins,
    strict: options.strict === true,
    allowedMarketplaces,
    mcpServers: mcp.ids,
    packs: packsFor(inputs),
    warnings,
  };

  const files: ManagedSettingsFile[] = hosts.map((host) => ({
    host,
    path: `${HOST_FACTS[host].dir}/managed-settings.json`,
    content: `${JSON.stringify(buildHostSettings(host, base, mcp.matchers), null, 2)}\n`,
  }));
  files.push({ path: 'README.md', content: renderReadme(base, files) });
  return { ...base, files };
}

/** Writes the plan's files under `outDir` and returns their absolute paths. Writes nothing else. */
export function writeManagedSettings(plan: ManagedSettingsPlan, outDir: string): string[] {
  const out = resolve(outDir);
  return plan.files.map((file) => {
    const target = resolve(out, ...file.path.split('/'));
    const rel = relative(out, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Refusing to write outside ${out}: ${file.path}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    return target;
  });
}

function resolveHosts(
  requested: ManagedSettingsOptions['host'],
  inputs: ProjectInputs,
): ManagedSettingsHost[] {
  const platforms = inputs.config.platforms;
  const served = MANAGED_SETTINGS_HOSTS.filter((h) => platforms.includes(HOST_FACTS[h].bundlePlatform));
  if (requested === undefined) {
    if (served.length > 0) return served;
    throw new Error(
      'No bundle platform is enabled. Add "claude-marketplace" or "agent-plugins" to platforms.',
    );
  }
  const hosts = requested === 'all' ? [...MANAGED_SETTINGS_HOSTS] : [requested];
  for (const host of hosts) {
    const { bundlePlatform, label } = HOST_FACTS[host];
    if (platforms.includes(bundlePlatform)) continue;
    throw new Error(
      `${label} installs the "${bundlePlatform}" bundles, but "${bundlePlatform}" is not in platforms. ` +
        `Add it and run "bluetemberg sync", or pass --host ${served[0] ?? '<host>'}.`,
    );
  }
  return hosts;
}

function validateRef(ref: string | undefined, hosts: ManagedSettingsHost[]): void {
  if (ref === undefined) return;
  if (!REF_RE.test(ref)) throw new Error(`--ref "${ref}" is not a valid git branch, tag or commit.`);
  if (!FULL_SHA_RE.test(ref)) return;
  const refusing = hosts.filter((h) => !HOST_FACTS[h].refAcceptsSha).map((h) => HOST_FACTS[h].label);
  if (refusing.length === 0) return;
  throw new Error(
    `--ref "${ref}" is a commit SHA, but ${refusing.join(' and ')} pins a marketplace to a branch or ` +
      'tag only. Tag the marketplace repo at that commit and pass the tag, or pass --host copilot.',
  );
}

function validateAllowMarketplaces(options: ManagedSettingsOptions): string[] {
  const extra = options.allowMarketplaces ?? [];
  if (extra.length > 0 && !options.strict) {
    throw new Error('--allow-marketplace only applies with --strict.');
  }
  for (const repo of extra) {
    if (!OWNER_REPO_RE.test(repo))
      throw new Error(`--allow-marketplace "${repo}" is not a GitHub owner/repo.`);
  }
  return [...new Set(extra)];
}

function selectPlugins(requested: string[] | undefined, inputs: ProjectInputs): string[] {
  const published = inputs.marketplace.plugins;
  if (requested === undefined || requested.length === 0) return [...published];
  const unknown = requested.filter((p) => !published.includes(p));
  if (unknown.length > 0) {
    throw new Error(
      `--plugin ${unknown.join(', ')} is not in .claude-plugin/marketplace.json (it lists ${published.join(', ')}).`,
    );
  }
  return [...new Set(requested)];
}

/** A stale index means the published marketplace may not hold what the config describes. */
function checkConfigMatchesIndex(inputs: ProjectInputs): void {
  const indexed = new Set(inputs.marketplace.plugins);
  const configured = new Set(inputs.configuredPlugins);
  const missing = [...configured].filter((p) => !indexed.has(p));
  const extra = [...indexed].filter((p) => !configured.has(p));
  if (missing.length === 0 && extra.length === 0) return;
  const detail = [
    missing.length > 0 ? `configured but not in the index: ${missing.join(', ')}` : '',
    extra.length > 0 ? `in the index but no longer configured: ${extra.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  throw new Error(
    `.claude-plugin/marketplace.json is out of date with marketplace.plugins (${detail}). Run "bluetemberg sync" and publish the output first.`,
  );
}

/**
 * Neither host pins a plugin version, so the marketplace content is what the policy delivers. The
 * bundle locks record which pack builds that content came from; refuse when they no longer match
 * `packages-lock.json`, since publishing these bundles would ship packs the lockfile has moved on from.
 */
function checkBundlesMatchLockfile(inputs: ProjectInputs): void {
  const drift: string[] = [];
  for (const { plugin, packs } of inputs.bundleLocks) {
    for (const [name, pin] of Object.entries(packs)) {
      const locked = inputs.lock.packages[name];
      if (!locked) drift.push(`${plugin}: ${name}@${pin.version} is no longer in packages-lock.json`);
      else if (locked.version !== pin.version || locked.integrity !== pin.integrity) {
        drift.push(`${plugin}: ${name} bundled ${pin.version}, lockfile has ${locked.version}`);
      }
    }
  }
  if (drift.length === 0) return;
  throw new Error(
    `The plugin bundles were built from different pack versions than packages-lock.json:\n  ${drift.join('\n  ')}\n` +
      'Run "bluetemberg sync", publish the output to the marketplace repo, then run this command again.',
  );
}

/**
 * A pack installed after the last sync is in the lockfile but in no bundle lock, so the drift check
 * above can't see it. Packs that ship nothing bundled (guardrails only, or another profile) look the
 * same, so this warns rather than refuses.
 */
function unbundledPackWarnings(inputs: ProjectInputs): string[] {
  if (inputs.bundleLocks.length === 0) return [];
  const bundled = new Set(inputs.bundleLocks.flatMap((b) => Object.keys(b.packs)));
  const missing = Object.keys(inputs.lock.packages).filter((name) => !bundled.has(name));
  if (missing.length === 0) return [];
  return [
    `packages-lock.json has pack(s) no plugin bundle records: ${missing.sort().join(', ')}. ` +
      'If they ship rules, skills or agents, run "bluetemberg sync" and publish before deploying.',
  ];
}

function packsFor(inputs: ProjectInputs): Record<string, PackPin> {
  const fromBundles: Record<string, PackPin> = {};
  for (const { packs } of inputs.bundleLocks) Object.assign(fromBundles, packs);
  const source =
    inputs.bundleLocks.length > 0
      ? fromBundles
      : Object.fromEntries(
          Object.entries(inputs.lock.packages).map(([n, e]) => [
            n,
            { version: e.version, integrity: e.integrity },
          ]),
        );
  return Object.fromEntries(Object.entries(source).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function mcpMatcher(id: string, config: McpServerConfig): McpMatcher {
  if (config.command) return { serverCommand: [config.command, ...(config.args ?? [])] };
  if (config.url) return { serverUrl: config.url };
  throw new Error(`llm/mcp.json server "${id}" has neither a command nor a url to match on.`);
}

/**
 * An allowlist of exactly the servers this project runs: `llm/mcp.json` (with presets resolved) plus
 * the root `.mcp.json`, which also holds servers people added by hand and sync keeps. Leaving those
 * out would block servers the project itself uses. An empty `allowedMcpServers` blocks every server
 * users add in both hosts, so a project without servers is refused rather than locked down.
 */
function mcpAllowlist(inputs: ProjectInputs): McpAllowlist {
  if (inputs.mcp !== null && inputs.mcp.errors.length > 0) {
    throw new Error(`llm/mcp.json has errors: ${inputs.mcp.errors.join('; ')}`);
  }
  if (inputs.rootMcp.error) throw new Error(inputs.rootMcp.error);
  const servers: [string, McpServerConfig][] = [
    ...Object.entries(inputs.mcp?.configs ?? {}),
    ...Object.entries(inputs.rootMcp.configs),
  ];
  if (servers.length === 0) {
    throw new Error(
      '--mcp-allowlist found no servers in llm/mcp.json or .mcp.json; an empty allowlist blocks every MCP server.',
    );
  }
  const matchers = new Map<string, McpMatcher>();
  for (const [id, config] of servers) {
    const matcher = mcpMatcher(id, config);
    matchers.set(JSON.stringify(matcher), matcher);
  }
  const ids = [...new Set(servers.map(([id]) => id))].sort();
  const withVars = [...matchers.values()].filter((m) => JSON.stringify(m).includes('${'));
  const warnings =
    withVars.length > 0
      ? [
          `${withVars.length} MCP allowlist entr${withVars.length === 1 ? 'y uses' : 'ies use'} \${VAR} expansion. Claude Code expands a policy entry from a pinned environment, so it may not match the running server; prefer literal commands and URLs.`,
        ]
      : [];
  return { ids, matchers: [...matchers.values()], warnings };
}

type Base = Omit<ManagedSettingsPlan, 'files'>;

function githubSource(repo: string, ref: string | undefined): Record<string, string> {
  return { source: 'github', repo, ...(ref ? { ref } : {}) };
}

/**
 * The allowlist entry for our marketplace is the exact source `extraKnownMarketplaces` registers:
 * Claude Code matches `ref` exactly (an entry without one matches only unpinned sources), so a
 * mismatch would block the very marketplace the policy installs from.
 */
function strictList(host: ManagedSettingsHost, base: Base): Record<string, string>[] {
  const ours = githubSource(base.marketplace.repo, base.marketplace.ref);
  const extra = base.allowedMarketplaces
    .filter((r) => r !== base.marketplace.repo)
    .map((r) => githubSource(r, undefined));
  // Claude Code stops loading skills-directory plugins under any allowlist without this entry.
  const skillsDir = host === 'claude' ? [{ source: 'skills-dir' }] : [];
  return [ours, ...extra, ...skillsDir];
}

function buildHostSettings(
  host: ManagedSettingsHost,
  base: Base,
  mcp: McpMatcher[],
): Record<string, unknown> {
  const { name, repo, ref, autoUpdate } = base.marketplace;
  return {
    ...(host === 'claude' ? { $schema: 'https://json.schemastore.org/claude-code-settings.json' } : {}),
    extraKnownMarketplaces: {
      [name]: { source: githubSource(repo, ref), ...(autoUpdate ? { autoUpdate: true } : {}) },
    },
    enabledPlugins: Object.fromEntries(base.plugins.map((p) => [`${p}@${name}`, true])),
    ...(base.strict ? { strictKnownMarketplaces: strictList(host, base) } : {}),
    ...(mcp.length > 0 ? { allowedMcpServers: mcp } : {}),
  };
}

export { CLAUDE_OFFICIAL_MARKETPLACE };
