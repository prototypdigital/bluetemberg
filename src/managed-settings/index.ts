import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { McpServerConfig } from '../mcp/registry.js';
import { planPluginFormats } from '../sync/marketplace.js';
import { AGENT_PLUGINS_PLATFORM, MARKETPLACE_PLATFORM } from '../types.js';
import {
  CLAUDE_OFFICIAL_MARKETPLACE,
  HOST_FACTS,
  MANAGED_SETTINGS_HOSTS,
  type ManagedSettingsHost,
} from './hosts.js';
import { OWNER_REPO_RE, readProjectInputs, type PackPin, type ProjectInputs } from './inputs.js';
import { README_MARKER, renderReadme } from './readme.js';
import {
  claudeTelemetryEnv,
  copilotTelemetry,
  planTelemetry,
  type TelemetryOptions,
  type TelemetryPlan,
} from './telemetry.js';

export { HOST_FACTS, MANAGED_SETTINGS_HOSTS, type ManagedSettingsHost } from './hosts.js';
export { TELEMETRY_PROTOCOLS, type TelemetryOptions, type TelemetryPlan } from './telemetry.js';

/**
 * `bluetemberg managed-settings`: org policy files for Claude Code and GitHub Copilot, derived from
 * the project's config, its generated marketplace index and its pack lockfile. Admins deploy the
 * files themselves (MDM, file push, or Copilot's `.github-private` repo). Sync never writes them,
 * and `writeManagedSettings` refuses a host's live policy path, `~/.claude`, symlinks, and any file
 * it did not generate: files land under `--out` only.
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
  /** Plugins to force-enable (default: every plugin the marketplace publishes for the host). */
  plugins?: string[];
  /** Also write `allowedMcpServers` listing exactly the project's MCP servers. */
  mcpAllowlist?: boolean;
  /**
   * Opt-in OpenTelemetry export to the org's own collector. Omitted, the files carry no telemetry
   * keys at all. Content capture is always written off.
   */
  telemetry?: TelemetryOptions;
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
  /** Every plugin force-enabled for at least one host. */
  plugins: string[];
  /** Plugins force-enabled per host: only those with a bundle in the host's format. */
  pluginsByHost: Partial<Record<ManagedSettingsHost, string[]>>;
  strict: boolean;
  allowedMarketplaces: string[];
  /** Server ids in `allowedMcpServers`; empty without `mcpAllowlist`. */
  mcpServers: string[];
  /** Pack versions the published bundles were built from (bundle locks, else the lockfile). */
  packs: Record<string, PackPin>;
  /** Whether the bundles were checked against `packages-lock.json` (needs Agent Plugins bundle locks). */
  driftChecked: boolean;
  /** The telemetry export written, or null when `telemetry` was not requested. */
  telemetry: TelemetryPlan | null;
  files: ManagedSettingsFile[];
  warnings: string[];
}

type McpMatcher = { serverCommand: string[] } | { serverUrl: string };

interface McpAllowlist {
  ids: string[];
  matchers: McpMatcher[];
  warnings: string[];
}

type Base = Omit<ManagedSettingsPlan, 'files'>;

/** A full commit SHA (SHA-1 or SHA-256 object names). A shorter hex string may be a tag. */
const FULL_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const REF_CHARS_RE = /^[A-Za-z0-9._/-]+$/;

export function planManagedSettings(root: string, options: ManagedSettingsOptions = {}): ManagedSettingsPlan {
  const inputs = readProjectInputs(root);
  const hosts = resolveHosts(options.host, inputs);
  validateRef(options.ref, hosts);
  const allowedMarketplaces = validateAllowMarketplaces(options);
  checkConfigMatchesIndex(inputs);
  const pluginsByHost = selectPlugins(options.plugins, hosts, inputs);
  checkBundlesMatchLockfile(inputs);

  const packs = packsFor(inputs);
  const telemetry = options.telemetry
    ? planTelemetry(options.telemetry, {
        hosts,
        marketplace: inputs.marketplace.name,
        ref: options.ref,
        packs,
        hostLabel: (h) => HOST_FACTS[h].label,
      })
    : null;

  const mcp: McpAllowlist = options.mcpAllowlist
    ? mcpAllowlist(inputs)
    : { ids: [], matchers: [], warnings: [] };
  const warnings: string[] = [
    ...mcp.warnings,
    ...driftWarnings(inputs),
    ...nameWarnings(root, inputs),
    ...(options.strict ? strictWarnings(hosts, inputs, allowedMarketplaces) : []),
    ...(telemetry?.warnings ?? []),
    ...(telemetry && telemetry.telemetry.packsDigest && inputs.bundleLocks.length === 0
      ? [
          'bluetemberg.packs.digest is computed from packages-lock.json, not from verified bundle locks; it only labels what users run if the published marketplace was built from this lockfile.',
        ]
      : []),
  ];

  const base: Base = {
    hosts,
    marketplace: {
      name: inputs.marketplace.name,
      repo: inputs.remote,
      ...(options.ref ? { ref: options.ref } : {}),
      autoUpdate: options.autoUpdate === true,
    },
    plugins: inputs.marketplace.plugins.filter((p) => hosts.some((h) => pluginsByHost[h]?.includes(p))),
    pluginsByHost,
    strict: options.strict === true,
    allowedMarketplaces,
    mcpServers: mcp.ids,
    packs,
    driftChecked: inputs.bundleLocks.length > 0,
    telemetry: telemetry?.telemetry ?? null,
    warnings,
  };

  const files: ManagedSettingsFile[] = hosts.map((host) => ({
    host,
    path: `${HOST_FACTS[host].dir}/managed-settings.json`,
    content: `${JSON.stringify(buildHostSettings(host, base, mcp.matchers), null, 2)}\n`,
  }));
  files.push({ path: 'README.md', content: renderReadme(base, files, inputs.source) });
  return { ...base, files };
}

/**
 * Writes the plan's files under `outDir` and returns their absolute paths. Every target is checked
 * before the first write, so a refusal leaves nothing half-written.
 */
export function writeManagedSettings(plan: ManagedSettingsPlan, outDir: string): string[] {
  const out = resolve(outDir);
  refuseProtectedOutDir(out);
  const targets = plan.files.map((file) => ({ file, target: checkedTarget(out, file) }));
  return targets.map(({ file, target }) => {
    mkdirSync(dirname(target), { recursive: true });
    // A directory under `out` that is a symlink would carry the write elsewhere.
    if (!isWithin(realpathSync(out), realpathSync(dirname(target)))) {
      throw new Error(`Refusing to write through a symlink outside ${out}: ${file.path}`);
    }
    writeFileSync(target, file.content);
    return target;
  });
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The host's live policy files, with `%ProgramFiles%` expanded when this machine defines it. */
function liveHostPaths(): string[] {
  const programFiles = process.env.ProgramFiles;
  return MANAGED_SETTINGS_HOSTS.flatMap((h) =>
    HOST_FACTS[h].filePaths.map(({ path }) =>
      programFiles ? path.replace('%ProgramFiles%', programFiles) : path,
    ),
  );
}

function refuseProtectedOutDir(out: string): void {
  const userClaude = join(homedir(), '.claude');
  if (isWithin(userClaude, out)) {
    throw new Error(
      `Refusing to write into ${userClaude}: pick an --out outside your Claude Code user settings.`,
    );
  }
}

function sameFile(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** Whether `content` is a file this command wrote earlier (so regenerating may replace it). */
function isOwnOutput(file: ManagedSettingsFile, content: string): boolean {
  if (!file.host) return content.startsWith(README_MARKER);
  try {
    const parsed: unknown = JSON.parse(content);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'extraKnownMarketplaces' in parsed &&
      'enabledPlugins' in parsed
    );
  } catch {
    return false;
  }
}

function checkedTarget(out: string, file: ManagedSettingsFile): string {
  const target = resolve(out, ...file.path.split('/'));
  const rel = relative(out, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to write outside ${out}: ${file.path}`);
  }
  if (liveHostPaths().some((live) => sameFile(live, target))) {
    throw new Error(
      `Refusing to write ${target}: that is a live host policy path. Write to another --out and deploy from there.`,
    );
  }
  if (!existsSync(target)) return target;
  if (lstatSync(target).isSymbolicLink()) throw new Error(`Refusing to write through a symlink: ${target}`);
  if (!isOwnOutput(file, readFileSync(target, 'utf8'))) {
    throw new Error(
      `Refusing to overwrite ${target}: it was not generated by this command. Pick an empty --out directory.`,
    );
  }
  return target;
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

/** The parts of `git check-ref-format` a hand-typed ref most often trips over. */
function isValidRef(ref: string): boolean {
  if (!REF_CHARS_RE.test(ref)) return false;
  if (ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/') || ref.endsWith('.')) return false;
  if (ref.includes('..') || ref.includes('//') || ref.includes('/.')) return false;
  return !ref.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'));
}

function validateRef(ref: string | undefined, hosts: ManagedSettingsHost[]): void {
  if (ref === undefined) return;
  if (!isValidRef(ref)) throw new Error(`--ref "${ref}" is not a valid git branch, tag or commit.`);
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

/**
 * The plugins each host can install: a plugin is written in a host's format only when that format's
 * platform is on and the plugin qualifies for it (an invalid Agent Plugins name keeps the Claude
 * bundle but drops the Agent Plugins one), so force-enabling it elsewhere would name a plugin the
 * host can't load.
 */
function enabledFormats(inputs: ProjectInputs): { claude: boolean; agentPlugins: boolean } {
  const platforms = inputs.config.platforms;
  return {
    claude: platforms.includes(MARKETPLACE_PLATFORM),
    agentPlugins: platforms.includes(AGENT_PLUGINS_PLATFORM),
  };
}

function pluginsPerHost(
  hosts: ManagedSettingsHost[],
  inputs: ProjectInputs,
): Record<ManagedSettingsHost, string[]> {
  const enabled = enabledFormats(inputs);
  const formatsOf = new Map(inputs.pluginDefs.map((d) => [d.name, planPluginFormats(d, enabled).formats]));
  const out = { claude: [] as string[], copilot: [] as string[] };
  for (const name of inputs.marketplace.plugins) {
    const formats = formatsOf.get(name);
    if (formats?.claude) out.claude.push(name);
    if (formats?.agentPlugins) out.copilot.push(name);
  }
  for (const host of hosts) {
    if (out[host].length > 0) continue;
    throw new Error(
      `No plugin in the marketplace has a ${HOST_FACTS[host].label} bundle; pass a different --host.`,
    );
  }
  return out;
}

function selectPlugins(
  requested: string[] | undefined,
  hosts: ManagedSettingsHost[],
  inputs: ProjectInputs,
): Partial<Record<ManagedSettingsHost, string[]>> {
  const available = pluginsPerHost(hosts, inputs);
  const wanted = requested && requested.length > 0 ? [...new Set(requested)] : null;
  const result: Partial<Record<ManagedSettingsHost, string[]>> = {};
  for (const host of hosts) {
    if (!wanted) {
      result[host] = available[host];
      continue;
    }
    const missing = wanted.filter((p) => !available[host].includes(p));
    if (missing.length > 0) {
      throw new Error(
        `--plugin ${missing.join(', ')} has no ${HOST_FACTS[host].label} bundle (available: ${available[host].join(', ')}). ` +
          'Pass --host for the host that has it.',
      );
    }
    result[host] = wanted;
  }
  return result;
}

/** A stale index means the published marketplace may not hold what the config describes. */
function checkConfigMatchesIndex(inputs: ProjectInputs): void {
  const indexed = new Set(inputs.marketplace.plugins);
  const configured = new Set(inputs.pluginDefs.map((d) => d.name));
  const extra = [...indexed].filter((p) => !configured.has(p));
  const missing = inputs.pluginDefs.filter((d) => !indexed.has(d.name));
  if (missing.length === 0 && extra.length === 0) return;
  // Sync leaves a plugin out of the index when it can't build it; re-running sync won't change that.
  const reasons = missing.map((d) => {
    const { issue } = planPluginFormats(d, enabledFormats(inputs));
    return issue ?? `"${d.name}" (if sync reports it resolved to 0 files, fix its profiles or stacks)`;
  });
  const detail = [
    reasons.length > 0 ? `configured but not in the index: ${reasons.join('; ')}` : '',
    extra.length > 0 ? `in the index but no longer configured: ${extra.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  throw new Error(
    `.claude-plugin/marketplace.json does not match marketplace.plugins (${detail}). Fix any errors "bluetemberg sync" reports, run it, and publish the output first.`,
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
      else if (locked.version !== pin.version) {
        drift.push(`${plugin}: ${name} bundled ${pin.version}, lockfile has ${locked.version}`);
      } else if (locked.integrity !== pin.integrity) {
        drift.push(`${plugin}: ${name}@${pin.version} was bundled from a build with a different integrity`);
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
 * What the drift check could not cover. Without Agent Plugins bundle locks it checked nothing; with
 * them, a pack installed after the last sync is in the lockfile but in no lock. Packs that ship
 * nothing bundled (guardrails or hooks only, or another profile) look the same, so this warns.
 */
function driftWarnings(inputs: ProjectInputs): string[] {
  if (inputs.bundleLocks.length === 0) {
    return [
      'Drift NOT checked: only Agent Plugins bundles carry a lock, so the published bundles could not be ' +
        'checked against packages-lock.json. Run "bluetemberg sync --check" before deploying, or add ' +
        '"agent-plugins" to platforms.',
    ];
  }
  const locked = new Set(inputs.bundleLocks.map((b) => b.plugin));
  const unlocked = inputs.marketplace.plugins.filter((p) => !locked.has(p));
  const bundled = new Set(inputs.bundleLocks.flatMap((b) => Object.keys(b.packs)));
  const unbundled = Object.keys(inputs.lock.packages).filter((name) => !bundled.has(name));
  return [
    ...(unlocked.length > 0
      ? [`Plugin(s) without a bundle lock were not checked for drift: ${unlocked.join(', ')}.`]
      : []),
    ...(unbundled.length > 0
      ? [
          `packages-lock.json has pack(s) no plugin bundle records: ${unbundled.sort().join(', ')}. ` +
            'If they ship rules, skills or agents, run "bluetemberg sync" and publish before deploying.',
        ]
      : []),
  ];
}

function nameWarnings(root: string, inputs: ProjectInputs): string[] {
  if (inputs.marketplace.name === basename(root)) return [];
  return [
    `The marketplace index is named "${inputs.marketplace.name}" but this folder is "${basename(root)}"; ` +
      'sync names the marketplace after the folder it runs in. The policy uses the index name, so ' +
      'make sure the published marketplace.json carries the same one.',
  ];
}

function githubRepoOf(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null || !('source' in entry)) return null;
  const source = (entry as { source: unknown }).source;
  if (typeof source !== 'object' || source === null) return null;
  const { source: kind, repo } = source as { source?: unknown; repo?: unknown };
  return kind === 'github' && typeof repo === 'string' ? repo : null;
}

/** Marketplaces an allowlist would block that someone evidently relies on. */
function strictWarnings(hosts: ManagedSettingsHost[], inputs: ProjectInputs, allowed: string[]): string[] {
  const allowedRepos = new Set([inputs.remote, ...allowed]);
  const blocked = Object.entries(inputs.projectMarketplaces)
    .filter(([name]) => name !== inputs.marketplace.name)
    .filter(([, entry]) => {
      const repo = githubRepoOf(entry);
      return repo === null || !allowedRepos.has(repo);
    })
    .map(([name, entry]) => {
      const repo = githubRepoOf(entry);
      return repo ? `${name} (--allow-marketplace ${repo})` : `${name} (not a GitHub source; add it by hand)`;
    });
  return [
    ...(blocked.length > 0
      ? [
          `--strict blocks marketplaces this project's .claude/settings.json registers: ${blocked.join(', ')}.`,
        ]
      : []),
    ...(hosts.includes('claude') && !allowedRepos.has(CLAUDE_OFFICIAL_MARKETPLACE)
      ? [
          `--strict blocks Claude Code's official marketplace; pass --allow-marketplace ${CLAUDE_OFFICIAL_MARKETPLACE} to keep it.`,
        ]
      : []),
    ...(hosts.includes('copilot') ? ["--strict turns off GitHub Copilot's built-in marketplaces."] : []),
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
  throw new Error(`MCP server "${id}" has neither a command nor a url to match on.`);
}

/**
 * An allowlist of exactly the servers this project runs: `<source>/mcp.json` (with presets resolved)
 * plus the root `.mcp.json`, which also holds servers people added by hand and sync keeps. Leaving
 * those out would block servers the project itself uses. An empty `allowedMcpServers` blocks every
 * server users add in both hosts, so a project without servers is refused rather than locked down.
 */
function mcpAllowlist(inputs: ProjectInputs): McpAllowlist {
  const manifest = `${inputs.source}/mcp.json`;
  if (inputs.mcp !== null && inputs.mcp.errors.length > 0) {
    throw new Error(`${manifest} has errors: ${inputs.mcp.errors.join('; ')}`);
  }
  if (inputs.rootMcp.error) throw new Error(inputs.rootMcp.error);
  const servers: [string, McpServerConfig][] = [
    ...Object.entries(inputs.mcp?.configs ?? {}),
    ...Object.entries(inputs.rootMcp.configs),
  ];
  if (servers.length === 0) {
    throw new Error(
      `--mcp-allowlist found no servers in ${manifest} or .mcp.json; an empty allowlist blocks every MCP server.`,
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
  const plugins = base.pluginsByHost[host] ?? [];
  return {
    ...(host === 'claude' ? { $schema: 'https://json.schemastore.org/claude-code-settings.json' } : {}),
    extraKnownMarketplaces: {
      [name]: { source: githubSource(repo, ref), ...(autoUpdate ? { autoUpdate: true } : {}) },
    },
    enabledPlugins: Object.fromEntries(plugins.map((p) => [`${p}@${name}`, true])),
    ...(base.strict ? { strictKnownMarketplaces: strictList(host, base) } : {}),
    ...(mcp.length > 0 ? { allowedMcpServers: mcp } : {}),
    ...telemetryKeys(host, base.telemetry),
  };
}

/** Claude Code takes telemetry as `env` variables; Copilot as one `telemetry` object. */
function telemetryKeys(host: ManagedSettingsHost, telemetry: TelemetryPlan | null): Record<string, unknown> {
  if (!telemetry) return {};
  if (host === 'claude') return { env: claudeTelemetryEnv(telemetry) };
  return { telemetry: copilotTelemetry(telemetry) };
}

export { CLAUDE_OFFICIAL_MARKETPLACE };
