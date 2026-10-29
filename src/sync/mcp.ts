import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import type { McpServerConfig } from '../mcp/registry.js';
import { BUILTIN_MCP_SERVERS, parseLlmMcpServerList } from '../mcp/registry.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedDelete, commitPlannedWrite } from './pipeline.js';
import { ANTIGRAVITY_MANAGED_FIELDS, ANTIGRAVITY_MCP_FILE, toAntigravityServers } from './antigravity.js';

/** Project-root MCP config read by Claude Code, VS Code and Copilot CLI (`mcpServers` format). */
export const ROOT_MCP_FILE = '.mcp.json';

/**
 * Sidecar in the source dir listing the merged-file servers bluetemberg wrote: `servers` for
 * `.mcp.json`, `antigravity` for `.agents/mcp_config.json`. JSON cannot carry the generated-file
 * banner, and Claude Code's own `claude mcp add` rewrites `.mcp.json` without any extra keys, so
 * ownership cannot live in those files — it lives here, committed next to `llm/mcp.json`.
 */
export const MCP_OWNERSHIP_FILE = 'mcp-managed.json';

/**
 * Fields of a server entry the manifest defines, in the order they are written (`type` first, as
 * Claude Code writes them). Any other field (e.g. `env`) a person added is kept after them.
 */
const MANAGED_FIELDS = ['type', 'command', 'args', 'url'] as const;
const MANAGED_FIELD_SET: ReadonlySet<string> = new Set(MANAGED_FIELDS);

const OWNERSHIP_COMMENT =
  'Written by bluetemberg sync: the .mcp.json servers it manages (from llm/mcp.json). Do not edit.';
const OWNERSHIP_COMMENT_WITH_ANTIGRAVITY =
  'Written by bluetemberg sync: the MCP servers it manages (from llm/mcp.json) in .mcp.json ' +
  '("servers") and .agents/mcp_config.json ("antigravity"). Do not edit.';

export interface McpSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

export type McpManifest =
  | { status: 'absent' }
  | { status: 'invalid'; error: string }
  | { status: 'ok'; entryCount: number; configs: Record<string, McpServerConfig>; errors: string[] };

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Reads and resolves `llm/mcp.json`. Pure: errors are returned, never recorded. */
export function loadMcpManifest(sourceBase: string): McpManifest {
  const manifestPath = join(sourceBase, 'mcp.json');
  if (!existsSync(manifestPath)) return { status: 'absent' };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'invalid', error: `failed to parse: ${message}` };
  }

  if (!isPlainObject(raw)) return { status: 'invalid', error: 'expected an object' };

  const servers = raw.servers;
  if (!Array.isArray(servers)) {
    return {
      status: 'invalid',
      error: 'expected an object with "servers" array of preset id strings and/or inline server objects',
    };
  }

  const { configs, errors } = parseLlmMcpServerList(servers, BUILTIN_MCP_SERVERS);
  return { status: 'ok', entryCount: servers.length, configs, errors };
}

/**
 * The exact bytes the pre-`.mcp.json` emitter wrote to `.claude/mcp.json` and `.github/mcp.json`
 * for this manifest. Prune uses them as proof that a leftover legacy file is bluetemberg's own.
 */
export function legacyMcpOutputs(sourceBase: string): { claude: string; copilot: string } | null {
  const manifest = loadMcpManifest(sourceBase);
  if (manifest.status !== 'ok') return null;
  return {
    claude: stringifyJson({ mcpServers: manifest.configs }),
    copilot: stringifyJson({ servers: manifest.configs }),
  };
}

/** Server ids bluetemberg owns, per merged file. */
interface McpOwnership {
  /** In the root `.mcp.json`. */
  root: string[];
  /** In `.agents/mcp_config.json`. */
  antigravity: string[];
}

const NO_OWNERSHIP: McpOwnership = { root: [], antigravity: [] };

function stringIds(value: unknown[]): string[] {
  return value.filter((id): id is string => typeof id === 'string');
}

/** Ids from the ownership sidecar, or an error when it exists but cannot be read as one. */
function readOwnedServerIds(path: string): { ids: McpOwnership; error?: string } {
  if (!existsSync(path)) return { ids: NO_OWNERSHIP };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const servers = isPlainObject(parsed) ? parsed.servers : undefined;
    if (!Array.isArray(servers)) return { ids: NO_OWNERSHIP, error: 'expected a "servers" array' };
    const antigravity = isPlainObject(parsed) ? (parsed.antigravity ?? []) : [];
    if (!Array.isArray(antigravity)) return { ids: NO_OWNERSHIP, error: '"antigravity" must be an array' };
    return { ids: { root: stringIds(servers), antigravity: stringIds(antigravity) } };
  } catch (err) {
    return { ids: NO_OWNERSHIP, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Structural equality for parsed JSON, ignoring object key order (array order still counts). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return a === b;
}

type MergedMcpRead =
  { status: 'absent' } | { status: 'corrupt'; error: string } | { status: 'ok'; data: JsonObject };

function readMergedMcp(path: string): MergedMcpRead {
  if (!existsSync(path)) return { status: 'absent' };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isPlainObject(parsed)) return { status: 'corrupt', error: 'expected a JSON object' };
    if (parsed.mcpServers !== undefined && !isPlainObject(parsed.mcpServers)) {
      return { status: 'corrupt', error: '"mcpServers" must be an object' };
    }
    return { status: 'ok', data: parsed };
  } catch (err) {
    return { status: 'corrupt', error: err instanceof Error ? err.message : String(err) };
  }
}

/** `.mcp.json` entries: the manifest-defined fields, in the order Claude Code writes them. */
function toRootServers(configs: Record<string, McpServerConfig>): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};
  for (const [id, config] of Object.entries(configs)) {
    const entry: JsonObject = {};
    for (const field of MANAGED_FIELDS) {
      if (config[field] !== undefined) entry[field] = config[field];
    }
    out[id] = entry;
  }
  return out;
}

/** Manifest-defined fields first, then every field a person added that the manifest does not set. */
function managedEntry(
  desired: JsonObject,
  previous: unknown,
  managedFields: ReadonlySet<string>,
): JsonObject {
  const entry: JsonObject = { ...desired };
  if (!isPlainObject(previous)) return entry;
  for (const [key, value] of Object.entries(previous)) {
    if (!managedFields.has(key)) entry[key] = value;
  }
  return entry;
}

/** Keeps a semantically unchanged entry exactly as it is on disk, so key order alone never rewrites the file. */
function preferExisting(entry: JsonObject, existing: unknown): unknown {
  return jsonEqual(entry, existing) ? existing : entry;
}

interface MergeResult {
  servers: JsonObject;
  /** Hand-written servers whose id the manifest now declares. */
  takenOver: string[];
}

/**
 * Updates managed servers in place (keeping their position), drops managed servers the manifest
 * no longer declares, keeps every other server untouched, and appends new ones in manifest order.
 */
function mergeServers(target: MergedMcpTarget, current: JsonObject): MergeResult {
  const { desired, owned, managedFields } = target;
  const servers: JsonObject = {};
  const takenOver: string[] = [];
  for (const [id, value] of Object.entries(current)) {
    if (Object.hasOwn(desired, id)) {
      servers[id] = preferExisting(managedEntry(desired[id], value, managedFields), value);
      if (!owned.has(id) && servers[id] !== value) takenOver.push(id);
      continue;
    }
    if (owned.has(id)) continue;
    servers[id] = value;
  }
  for (const [id, entry] of Object.entries(desired)) {
    if (!Object.hasOwn(servers, id)) servers[id] = managedEntry(entry, undefined, managedFields);
  }
  return { servers, takenOver };
}

/** Writes a merged MCP file, leaving it byte-for-byte alone when nothing changed. */
function commitMergedMcp(ctx: McpSyncContext, path: string, data: JsonObject, servers: JsonObject): void {
  const otherKeys = Object.keys(data).filter((key) => key !== 'mcpServers');
  if (Object.keys(servers).length === 0 && otherKeys.length === 0) {
    commitPlannedDelete(ctx, path);
    return;
  }

  const updated = { ...data, mcpServers: servers };
  const content = stringifyJson(updated);
  if (existsSync(path) && stringifyJson(data) === content) return;
  commitPlannedWrite(ctx, path, content);
}

function commitOwnership(ctx: McpSyncContext, path: string, ids: McpOwnership): void {
  if (ids.root.length === 0 && ids.antigravity.length === 0) {
    commitPlannedDelete(ctx, path);
    return;
  }
  // Without Antigravity servers the sidecar keeps the shape it had before Antigravity existed.
  const sidecar =
    ids.antigravity.length === 0
      ? { $comment: OWNERSHIP_COMMENT, servers: [...ids.root].sort() }
      : {
          $comment: OWNERSHIP_COMMENT_WITH_ANTIGRAVITY,
          servers: [...ids.root].sort(),
          antigravity: [...ids.antigravity].sort(),
        };
  commitPlannedWrite(ctx, path, stringifyJson(sidecar));
}

/** One MCP config file sync merges into, keeping servers it does not own. */
interface MergedMcpTarget {
  /** Path relative to the project root. */
  file: string;
  /** Server entries the manifest wants in this file, already in the file's own format. */
  desired: Record<string, JsonObject>;
  /** Entry fields the manifest defines; any other field a person added is kept. */
  managedFields: ReadonlySet<string>;
  /** Servers bluetemberg wrote to this file on an earlier sync. */
  owned: ReadonlySet<string>;
}

/**
 * Merges the manifest's servers into one MCP config file. bluetemberg adds, updates and removes
 * only the servers recorded in {@link MCP_OWNERSHIP_FILE} or declared by the manifest; servers a
 * person (or `claude mcp add --scope project`) wrote are never touched. A corrupt file is reported
 * and left as it is rather than replaced. Returns the ids bluetemberg owns in the file afterwards.
 */
function syncMergedMcp(
  ctx: McpSyncContext,
  target: MergedMcpTarget,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): string[] {
  const desiredIds = Object.keys(target.desired);
  if (desiredIds.length === 0 && target.owned.size === 0) return [];

  const path = join(ctx.root, target.file);
  const existing = readMergedMcp(path);
  if (existing.status === 'corrupt') {
    recordError(`${target.file}: ${existing.error} — left untouched; fix it and re-run sync`);
    return [...target.owned];
  }

  const data = existing.status === 'ok' ? existing.data : {};
  const current = isPlainObject(data.mcpServers) ? data.mcpServers : {};
  const { servers, takenOver } = mergeServers(target, current);
  if (!ctx.checkMode) {
    for (const id of takenOver) {
      recordWarning(
        `${target.file}: server "${id}" was hand-written; llm/mcp.json declares it, so bluetemberg now manages it`,
      );
    }
  }

  commitMergedMcp(ctx, path, data, servers);
  return desiredIds;
}

/**
 * Merges the manifest into the root `.mcp.json` (when `claude` or `copilot` is selected) and
 * `.agents/mcp_config.json` (when `antigravity` is), then records what it owns in one sidecar
 * write. A platform that is no longer selected gets its owned servers removed.
 */
function syncMergedMcpFiles(
  ctx: McpSyncContext,
  configs: Record<string, McpServerConfig>,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): void {
  const ownershipPath = join(ctx.sourceBase, MCP_OWNERSHIP_FILE);
  const ownership = readOwnedServerIds(ownershipPath);
  if (ownership.error !== undefined && !ctx.checkMode) {
    recordWarning(
      `llm/${MCP_OWNERSHIP_FILE}: ${ownership.error} — servers removed from llm/mcp.json may be left in ${ROOT_MCP_FILE} or ${ANTIGRAVITY_MCP_FILE}; this sync rewrites it`,
    );
  }

  const writesRoot = ctx.platforms.includes('claude') || ctx.platforms.includes('copilot');
  const root = syncMergedMcp(
    ctx,
    {
      file: ROOT_MCP_FILE,
      desired: writesRoot ? toRootServers(configs) : {},
      managedFields: MANAGED_FIELD_SET,
      owned: new Set(ownership.ids.root),
    },
    recordError,
    recordWarning,
  );
  const antigravity = syncMergedMcp(
    ctx,
    {
      file: ANTIGRAVITY_MCP_FILE,
      desired: ctx.platforms.includes('antigravity') ? toAntigravityServers(configs) : {},
      managedFields: ANTIGRAVITY_MANAGED_FIELDS,
      owned: new Set(ownership.ids.antigravity),
    },
    recordError,
    recordWarning,
  );
  commitOwnership(ctx, ownershipPath, { root, antigravity });
}

/**
 * Emits MCP config from `llm/mcp.json`: a merged root `.mcp.json` (Claude Code, VS Code, Copilot
 * CLI) when `claude` or `copilot` is selected, a merged `.agents/mcp_config.json` for Antigravity,
 * and a fully generated `.cursor/mcp.json` for Cursor. The Codex `[mcp_servers.*]` block is
 * written by `syncCodexConfig`.
 */
export function syncMcp(
  ctx: McpSyncContext,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): void {
  const manifest = loadMcpManifest(ctx.sourceBase);
  if (manifest.status === 'invalid') {
    recordError(`mcp.json: ${manifest.error}`);
    return;
  }

  const configs = manifest.status === 'ok' ? manifest.configs : {};
  const errors = manifest.status === 'ok' ? manifest.errors : [];
  for (const err of errors) recordError(`mcp.json: ${err}`);

  // A manifest entry that failed to resolve must not read as "removed": keep the previous state.
  if (errors.length === 0) syncMergedMcpFiles(ctx, configs, recordError, recordWarning);

  if (manifest.status !== 'ok') return;

  const writesRoot = ctx.platforms.includes('claude') || ctx.platforms.includes('copilot');
  const writesAntigravity = ctx.platforms.includes('antigravity');
  const writesCursor = ctx.platforms.includes('cursor');
  if (writesCursor) {
    commitPlannedWrite(ctx, join(ctx.root, '.cursor', 'mcp.json'), stringifyJson({ mcpServers: configs }));
  }

  if (ctx.checkMode || (!writesRoot && !writesAntigravity && !writesCursor)) return;
  const count = manifest.entryCount;
  ctx.log(`MCP: ${count} manifest entr${count === 1 ? 'y' : 'ies'} from llm/mcp.json`);
  if (writesRoot) ctx.log(`  -> ${ROOT_MCP_FILE} (merged)`);
  if (writesAntigravity) ctx.log(`  -> ${ANTIGRAVITY_MCP_FILE} (merged)`);
  if (writesCursor) ctx.log(`  -> .cursor/mcp.json`);
}
