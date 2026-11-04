import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_LOCK_FILE } from '../sync/agent-plugins.js';
import { hasSyncConfig, loadConfig } from '../sync/index.js';
import { pluginDefinitionsFor } from '../sync/marketplace.js';
import { loadMcpManifest, ROOT_MCP_FILE } from '../sync/mcp.js';
import { readLockfile } from '../registry/manifest.js';
import type { McpServerConfig } from '../mcp/registry.js';
import { AGENT_PLUGINS_PLATFORM } from '../types.js';
import type { BlueprintConfig, MarketplacePluginDefinition, PackageLock } from '../types.js';

/** `owner/repo`, the only form both hosts accept for a `github` marketplace source. */
export const OWNER_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/** The published marketplace as sync wrote it to `.claude-plugin/marketplace.json`. */
export interface PublishedMarketplace {
  name: string;
  plugins: string[];
}

/** The two lock fields that identify a pack build. */
export interface PackPin {
  version: string;
  integrity: string;
}

/** One bundle's lock, as sync wrote it next to an Agent Plugins bundle. */
export interface BundleLockPacks {
  plugin: string;
  packs: Record<string, PackPin>;
}

/** Everything the command reads from the project. Nothing here is written back. */
export interface ProjectInputs {
  config: BlueprintConfig;
  remote: string;
  marketplace: PublishedMarketplace;
  /** `marketplace.plugins`, or the default single plugin sync builds. */
  pluginDefs: MarketplacePluginDefinition[];
  /** The config `source` dir (`llm` by default), for messages. */
  source: string;
  lock: PackageLock;
  bundleLocks: BundleLockPacks[];
  mcp: { configs: Record<string, McpServerConfig>; errors: string[] } | null;
  /** Servers in the root `.mcp.json`, including ones people added there by hand. */
  rootMcp: { configs: Record<string, McpServerConfig>; error?: string };
  /** Marketplaces the project's `.claude/settings.json` registers, by name. */
  projectMarketplaces: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The configured marketplace repo, or a refusal that says how to configure one. */
export function requireRemote(config: BlueprintConfig): string {
  const remote = config.marketplace?.remote?.trim();
  if (!remote) {
    throw new Error(
      'No marketplace is configured. Set "marketplace.remote" to the owner/repo that hosts your ' +
        'published plugins in bluetemberg.config.json, run "bluetemberg sync", push the output to ' +
        'that repo, then run this command again.',
    );
  }
  if (!OWNER_REPO_RE.test(remote)) {
    throw new Error(`marketplace.remote "${remote}" is not a GitHub owner/repo.`);
  }
  return remote;
}

/** Reads the marketplace index sync generated; the published names come from here. */
export function readPublishedMarketplace(root: string): PublishedMarketplace {
  const path = join(root, '.claude-plugin', 'marketplace.json');
  if (!existsSync(path)) {
    throw new Error(
      'No .claude-plugin/marketplace.json found. Add "claude-marketplace" or "agent-plugins" to ' +
        'platforms and run "bluetemberg sync" first; the policy names the plugins that file lists.',
    );
  }
  const raw = readJson(path);
  if (!isRecord(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.plugins)) {
    throw new Error(`${path} has no marketplace "name" and "plugins" list.`);
  }
  const plugins = raw.plugins.flatMap((p) => (isRecord(p) && typeof p.name === 'string' ? [p.name] : []));
  if (plugins.length === 0) throw new Error(`${path} lists no plugins.`);
  return { name: raw.name, plugins };
}

function readBundleLock(root: string, plugin: string): BundleLockPacks | null {
  const path = join(root, 'plugins', plugin, ...BUNDLE_LOCK_FILE.split('/'));
  if (!existsSync(path)) return null;
  const raw = readJson(path);
  if (!isRecord(raw) || raw.generator !== 'bluetemberg' || !isRecord(raw.packs)) return null;
  const packs: Record<string, PackPin> = {};
  for (const [name, entry] of Object.entries(raw.packs)) {
    if (isRecord(entry) && typeof entry.version === 'string' && typeof entry.integrity === 'string') {
      packs[name] = { version: entry.version, integrity: entry.integrity };
    }
  }
  return { plugin, packs };
}

function readMcp(sourceBase: string): ProjectInputs['mcp'] {
  const manifest = loadMcpManifest(sourceBase);
  if (manifest.status === 'absent') return null;
  if (manifest.status === 'invalid') return { configs: {}, errors: [manifest.error] };
  return { configs: manifest.configs, errors: manifest.errors };
}

/**
 * A `.mcp.json` entry as an allowlist source. Arguments that aren't strings can't be matched
 * exactly, and dropping them would allowlist a different command than the one that runs.
 */
function toServerConfig(id: string, value: Record<string, unknown>): McpServerConfig {
  const config: McpServerConfig = { type: typeof value.type === 'string' ? value.type : 'stdio' };
  if (typeof value.command === 'string') config.command = value.command;
  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || !value.args.every((a) => typeof a === 'string')) {
      throw new Error(`${ROOT_MCP_FILE} server "${id}" has "args" that are not all strings.`);
    }
    config.args = value.args;
  }
  if (typeof value.url === 'string') config.url = value.url;
  return config;
}

/** The root `.mcp.json` sync merges into; servers there run in this project whoever added them. */
function readRootMcp(root: string): ProjectInputs['rootMcp'] {
  const path = join(root, ROOT_MCP_FILE);
  if (!existsSync(path)) return { configs: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return {
      configs: {},
      error: `${ROOT_MCP_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const servers = isRecord(raw) && isRecord(raw.mcpServers) ? raw.mcpServers : {};
  const configs: Record<string, McpServerConfig> = {};
  try {
    for (const [id, value] of Object.entries(servers)) {
      if (isRecord(value)) configs[id] = toServerConfig(id, value);
    }
  } catch (err) {
    return { configs: {}, error: err instanceof Error ? err.message : String(err) };
  }
  return { configs };
}

function readProjectMarketplaces(root: string): Record<string, unknown> {
  const path = join(root, '.claude', 'settings.json');
  if (!existsSync(path)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(raw) && isRecord(raw.extraKnownMarketplaces) ? raw.extraKnownMarketplaces : {};
  } catch {
    return {};
  }
}

export function readProjectInputs(root: string): ProjectInputs {
  if (!hasSyncConfig(root, false)) {
    throw new Error(`No bluetemberg.config.json found in ${root} or its parents.`);
  }
  const config = loadConfig(root);
  const remote = requireRemote(config);
  const marketplace = readPublishedMarketplace(root);
  const source = config.source || 'llm';
  // A lock left behind after `agent-plugins` was turned off describes no bundle sync still builds.
  const locksCurrent = config.platforms.includes(AGENT_PLUGINS_PLATFORM);
  return {
    config,
    remote,
    marketplace,
    pluginDefs: pluginDefinitionsFor(config, root),
    source,
    lock: readLockfile(root, source),
    bundleLocks: locksCurrent ? marketplace.plugins.flatMap((p) => readBundleLock(root, p) ?? []) : [],
    mcp: readMcp(join(root, source)),
    rootMcp: readRootMcp(root),
    projectMarketplaces: readProjectMarketplaces(root),
  };
}
