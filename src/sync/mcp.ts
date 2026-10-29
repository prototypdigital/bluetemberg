import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import type { McpServerConfig } from '../mcp/registry.js';
import { BUILTIN_MCP_SERVERS, parseLlmMcpServerList } from '../mcp/registry.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedDelete, commitPlannedWrite } from './pipeline.js';

/** Project-root MCP config read by Claude Code, VS Code and Copilot CLI (`mcpServers` format). */
export const ROOT_MCP_FILE = '.mcp.json';

/**
 * Sidecar in the source dir listing the `.mcp.json` servers bluetemberg wrote. JSON cannot carry
 * the generated-file banner, and Claude Code's own `claude mcp add` rewrites `.mcp.json` without
 * any extra keys, so ownership cannot live in that file — it lives here, committed next to
 * `llm/mcp.json`.
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

/** Ids from the ownership sidecar, or an error when it exists but cannot be read as one. */
function readOwnedServerIds(path: string): { ids: string[]; error?: string } {
  if (!existsSync(path)) return { ids: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const servers = isPlainObject(parsed) ? parsed.servers : undefined;
    if (!Array.isArray(servers)) return { ids: [], error: 'expected a "servers" array' };
    return { ids: servers.filter((id): id is string => typeof id === 'string') };
  } catch (err) {
    return { ids: [], error: err instanceof Error ? err.message : String(err) };
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

type RootMcpRead =
  { status: 'absent' } | { status: 'corrupt'; error: string } | { status: 'ok'; data: JsonObject };

function readRootMcp(path: string): RootMcpRead {
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

/** Manifest-defined fields first, then every field a person added that the manifest does not set. */
function managedEntry(config: McpServerConfig, previous: unknown): JsonObject {
  const entry: JsonObject = {};
  for (const field of MANAGED_FIELDS) {
    if (config[field] !== undefined) entry[field] = config[field];
  }
  if (!isPlainObject(previous)) return entry;
  for (const [key, value] of Object.entries(previous)) {
    if (!MANAGED_FIELD_SET.has(key)) entry[key] = value;
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
function mergeServers(
  current: JsonObject,
  desired: Record<string, McpServerConfig>,
  owned: ReadonlySet<string>,
): MergeResult {
  const servers: JsonObject = {};
  const takenOver: string[] = [];
  for (const [id, value] of Object.entries(current)) {
    if (Object.hasOwn(desired, id)) {
      servers[id] = preferExisting(managedEntry(desired[id], value), value);
      if (!owned.has(id) && servers[id] !== value) takenOver.push(id);
      continue;
    }
    if (owned.has(id)) continue;
    servers[id] = value;
  }
  for (const [id, config] of Object.entries(desired)) {
    if (!Object.hasOwn(servers, id)) servers[id] = managedEntry(config, undefined);
  }
  return { servers, takenOver };
}

/** Writes the merged `.mcp.json`, leaving the file byte-for-byte alone when nothing changed. */
function commitRootMcp(ctx: McpSyncContext, path: string, data: JsonObject, servers: JsonObject): void {
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

function commitOwnership(ctx: McpSyncContext, path: string, ids: string[]): void {
  if (ids.length === 0) {
    commitPlannedDelete(ctx, path);
    return;
  }
  commitPlannedWrite(ctx, path, stringifyJson({ $comment: OWNERSHIP_COMMENT, servers: [...ids].sort() }));
}

/**
 * Merges the manifest's servers into the root `.mcp.json`. bluetemberg adds, updates and removes
 * only the servers recorded in {@link MCP_OWNERSHIP_FILE} or declared by the manifest; servers a
 * person (or `claude mcp add --scope project`) wrote are never touched. A corrupt `.mcp.json` is
 * reported and left as it is rather than replaced.
 */
function syncRootMcp(
  ctx: McpSyncContext,
  desired: Record<string, McpServerConfig>,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): void {
  const mcpPath = join(ctx.root, ROOT_MCP_FILE);
  const ownershipPath = join(ctx.sourceBase, MCP_OWNERSHIP_FILE);
  const ownership = readOwnedServerIds(ownershipPath);
  if (ownership.error !== undefined && !ctx.checkMode) {
    recordWarning(
      `llm/${MCP_OWNERSHIP_FILE}: ${ownership.error} — servers removed from llm/mcp.json may be left in ${ROOT_MCP_FILE}; this sync rewrites it`,
    );
  }
  const owned = new Set(ownership.ids);
  const desiredIds = Object.keys(desired);
  if (desiredIds.length === 0 && owned.size === 0) return;

  const existing = readRootMcp(mcpPath);
  if (existing.status === 'corrupt') {
    recordError(`${ROOT_MCP_FILE}: ${existing.error} — left untouched; fix it and re-run sync`);
    return;
  }

  const data = existing.status === 'ok' ? existing.data : {};
  const current = isPlainObject(data.mcpServers) ? data.mcpServers : {};
  const { servers, takenOver } = mergeServers(current, desired, owned);
  if (!ctx.checkMode) {
    for (const id of takenOver) {
      recordWarning(
        `${ROOT_MCP_FILE}: server "${id}" was hand-written; llm/mcp.json declares it, so bluetemberg now manages it`,
      );
    }
  }

  commitRootMcp(ctx, mcpPath, data, servers);
  commitOwnership(ctx, ownershipPath, desiredIds);
}

/**
 * Emits MCP config from `llm/mcp.json`: a merged root `.mcp.json` (Claude Code, VS Code, Copilot
 * CLI) when `claude` or `copilot` is selected, and a fully generated `.cursor/mcp.json` for Cursor.
 * The Codex `[mcp_servers.*]` block is written by `syncCodexConfig`.
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

  const writesRoot = ctx.platforms.includes('claude') || ctx.platforms.includes('copilot');
  // A manifest entry that failed to resolve must not read as "removed": keep the previous state.
  if (errors.length === 0) syncRootMcp(ctx, writesRoot ? configs : {}, recordError, recordWarning);

  if (manifest.status !== 'ok') return;

  const writesCursor = ctx.platforms.includes('cursor');
  if (writesCursor) {
    commitPlannedWrite(ctx, join(ctx.root, '.cursor', 'mcp.json'), stringifyJson({ mcpServers: configs }));
  }

  if (ctx.checkMode || (!writesRoot && !writesCursor)) return;
  const count = manifest.entryCount;
  ctx.log(`MCP: ${count} manifest entr${count === 1 ? 'y' : 'ies'} from llm/mcp.json`);
  if (writesRoot) ctx.log(`  -> ${ROOT_MCP_FILE} (merged)`);
  if (writesCursor) ctx.log(`  -> .cursor/mcp.json`);
}
