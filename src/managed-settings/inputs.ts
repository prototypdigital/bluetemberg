import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_LOCK_FILE } from '../sync/agent-plugins.js';
import { hasSyncConfig, loadConfig } from '../sync/index.js';
import { pluginDefinitionsFor } from '../sync/marketplace.js';
import { loadMcpManifest } from '../sync/mcp.js';
import { readLockfile } from '../registry/manifest.js';
import type { McpServerConfig } from '../mcp/registry.js';
import type { BlueprintConfig, PackageLock } from '../types.js';

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
  /** Plugin names `marketplace.plugins` (or the default single plugin) defines. */
  configuredPlugins: string[];
  lock: PackageLock;
  bundleLocks: BundleLockPacks[];
  mcp: { configs: Record<string, McpServerConfig>; errors: string[] } | null;
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

export function readProjectInputs(root: string): ProjectInputs {
  if (!hasSyncConfig(root, false)) {
    throw new Error(`No bluetemberg.config.json found in ${root} or its parents.`);
  }
  const config = loadConfig(root);
  const remote = requireRemote(config);
  const marketplace = readPublishedMarketplace(root);
  const source = config.source || 'llm';
  return {
    config,
    remote,
    marketplace,
    configuredPlugins: pluginDefinitionsFor(config, root).map((p) => p.name),
    lock: readLockfile(root, source),
    bundleLocks: marketplace.plugins.flatMap((p) => readBundleLock(root, p) ?? []),
    mcp: readMcp(join(root, source)),
  };
}
