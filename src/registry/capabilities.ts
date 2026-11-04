import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { ENGINE_MARKER_FILES, SCRIPT_EXTENSIONS, sanitizeForTerminal } from './scanner.js';

/**
 * What a pack (or external source) can make an agent's host *do*, as opposed to what it tells the
 * agent: guardrail hooks, hook configs, executable scripts, and MCP server declarations.
 *
 * The content scan cannot judge whether prose instructions are benign. This summary moves the review
 * to something a person can judge: "this update adds a hook and two scripts". Pure: it reads the
 * cached dir and returns data; the command module decides how to print it.
 */
export interface PackCapabilities {
  /** Guardrail id → its trigger (the tool it gates). */
  guardrails: Map<string, string>;
  /** `<file>: <event>` → the commands registered for it, joined. */
  hooks: Map<string, string>;
  /** Script path → SHA-256 of its bytes (any script extension, or an executable bit). */
  scripts: Map<string, string>;
  /** `<file>: <server>` → its command line or URL. */
  mcpServers: Map<string, string>;
}

export type CapabilityKind = keyof PackCapabilities;
export type CapabilityChangeType = 'added' | 'removed' | 'changed';

export interface CapabilityChange {
  kind: CapabilityKind;
  item: string;
  change: CapabilityChangeType;
}

const KIND_LABELS: Record<CapabilityKind, string> = {
  guardrails: 'guardrail',
  hooks: 'hook',
  scripts: 'script',
  mcpServers: 'MCP server',
};
const CAPABILITY_KINDS = Object.keys(KIND_LABELS) as CapabilityKind[];
const HOOK_FILES = new Set(['hooks.json', 'claude-hooks.json', 'hooks.claude.json']);
const MCP_FILES = new Set(['mcp.json', '.mcp.json']);
/** Top-level files every npm tarball carries; never synced, never run. */
const PACKAGE_FILES = new Set(['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE']);
const EXECUTABLE_BITS = 0o111;
const MAX_DESCRIPTION_CHARS = 120;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function describe(text: string): string {
  const clean = sanitizeForTerminal(text.replace(/\s+/g, ' ').trim());
  return clean.length > MAX_DESCRIPTION_CHARS ? `${clean.slice(0, MAX_DESCRIPTION_CHARS)}…` : clean;
}

function listFiles(dir: string, atRoot = true): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, false));
    else if (
      entry.isFile() &&
      !(atRoot && (ENGINE_MARKER_FILES.has(entry.name) || PACKAGE_FILES.has(entry.name)))
    )
      files.push(full);
  }
  return files;
}

function extensionOf(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isScript(full: string): boolean {
  if (SCRIPT_EXTENSIONS.has(extensionOf(full))) return true;
  return (statSync(full).mode & EXECUTABLE_BITS) !== 0;
}

/** Every `command` string under a value (Claude nests them as `hooks[].hooks[].command`). */
function commandsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(commandsIn);
  if (!isObject(value)) return [];
  const own = typeof value.command === 'string' ? [value.command] : [];
  return [...own, ...Object.values(value).flatMap(commandsIn)];
}

function collectHooks(rel: string, json: unknown, into: Map<string, string>): void {
  if (!isObject(json) || !isObject(json.hooks)) return;
  for (const [event, entries] of Object.entries(json.hooks)) {
    const commands = commandsIn(entries);
    if (commands.length > 0) into.set(`${rel}: ${describe(event)}`, describe(commands.join(' ; ')));
  }
}

function collectMcpServers(rel: string, json: unknown, into: Map<string, string>): void {
  if (!isObject(json)) return;
  const servers = isObject(json.mcpServers) ? json.mcpServers : isObject(json.servers) ? json.servers : null;
  if (!servers) return;
  for (const [name, config] of Object.entries(servers)) {
    if (!isObject(config)) continue;
    const args = Array.isArray(config.args) ? config.args.filter((a) => typeof a === 'string') : [];
    const target = typeof config.url === 'string' ? config.url : [config.command, ...args].join(' ');
    into.set(`${rel}: ${describe(name)}`, describe(String(target)));
  }
}

function collectGuardrail(rel: string, full: string, into: Map<string, string>): void {
  try {
    const { data } = matter(readFileSync(full, 'utf8'));
    const trigger = typeof data.trigger === 'string' ? data.trigger : '?';
    into.set(describe(basename(rel, '.md')), describe(trigger));
  } catch {
    into.set(describe(basename(rel, '.md')), '(unparsable frontmatter)');
  }
}

/** The capabilities a cached pack or source dir carries. A missing dir has none. */
export function collectCapabilities(dir: string): PackCapabilities {
  const caps: PackCapabilities = {
    guardrails: new Map(),
    hooks: new Map(),
    scripts: new Map(),
    mcpServers: new Map(),
  };
  if (!existsSync(dir)) return caps;

  for (const full of listFiles(dir)) {
    const rel = sanitizeForTerminal(relative(dir, full).split(sep).join('/'));
    const name = basename(full);
    if (rel.split('/').at(-2) === 'guardrails' && name.endsWith('.md'))
      collectGuardrail(rel, full, caps.guardrails);
    if (HOOK_FILES.has(name)) collectHooks(rel, readJson(full), caps.hooks);
    if (MCP_FILES.has(name)) collectMcpServers(rel, readJson(full), caps.mcpServers);
    if (isScript(full)) caps.scripts.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex'));
  }
  return caps;
}

/** What changed between two versions; `before = null` reports everything as added. */
export function diffCapabilities(
  before: PackCapabilities | null,
  after: PackCapabilities,
): CapabilityChange[] {
  const changes: CapabilityChange[] = [];
  for (const kind of CAPABILITY_KINDS) {
    const old = before?.[kind] ?? new Map<string, string>();
    const next = after[kind];
    for (const [item, value] of next) {
      if (!old.has(item)) changes.push({ kind, item, change: 'added' });
      else if (old.get(item) !== value) changes.push({ kind, item, change: 'changed' });
    }
    for (const item of old.keys()) if (!next.has(item)) changes.push({ kind, item, change: 'removed' });
  }
  return changes;
}

/** True when a change widens what the pack can do (anything added or changed). */
export function growsCapabilities(changes: readonly CapabilityChange[]): boolean {
  return changes.some((c) => c.change !== 'removed');
}

const CHANGE_SIGNS: Record<CapabilityChangeType, string> = { added: '+', removed: '-', changed: '~' };
/** Most items listed per summary; the rest are counted. */
const MAX_LISTED = 15;

/** One line per change (`+ hook  claude-hooks.json: PreToolUse`), capped for a hostile pack. */
export function formatCapabilityChanges(changes: readonly CapabilityChange[], indent = '    '): string[] {
  const lines = changes
    .slice(0, MAX_LISTED)
    .map((c) => `${indent}${CHANGE_SIGNS[c.change]} ${KIND_LABELS[c.kind]}: ${c.item}`);
  if (changes.length > MAX_LISTED) lines.push(`${indent}…and ${changes.length - MAX_LISTED} more`);
  return lines;
}

/**
 * The lines a command logs after installing a version: what it can run or gate, against the version
 * it replaces (`before = null` for a first install). Empty when nothing changed. The content scan
 * cannot tell whether prose is benign; a capability change is something a reviewer can judge.
 */
export function capabilityReport(label: string, before: PackCapabilities | null, afterDir: string): string[] {
  const changes = diffCapabilities(before, collectCapabilities(afterDir));
  if (changes.length === 0) return [];
  const lines = [`  ${label} ${before ? 'changes what it can run or gate' : 'can run or gate'}:`];
  lines.push(...formatCapabilityChanges(changes));
  if (before && growsCapabilities(changes)) {
    lines.push('    Review these before syncing: hooks and guardrails run on tool calls automatically.');
  }
  return lines;
}
