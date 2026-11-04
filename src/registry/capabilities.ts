import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { sanitizeForTerminal } from './scanner.js';

/**
 * What a pack (or external source) can make an agent's host *do*, as opposed to what it tells the
 * agent: the guardrails sync compiles into hooks, the `claude-hooks.json` marketplace bundles carry,
 * and the files a skill ships next to its `SKILL.md` (scripts the skill tells the agent to run).
 *
 * The content scan cannot judge whether prose instructions are benign. This summary moves the review
 * to something a person can judge: "this update changes a guardrail and adds two skill files".
 * It reads only what sync reads from a source dir, and compares full content hashes, so any edit to
 * one of these files shows up. Pure: it returns data; the command module decides how to print it.
 */
export interface Capability {
  /** SHA-256 of the full content; what the diff compares. */
  hash: string;
  /** What to print: sanitised and truncated, never compared. */
  label: string;
}

export interface PackCapabilities {
  guardrails: Map<string, Capability>;
  hooks: Map<string, Capability>;
  skillFiles: Map<string, Capability>;
}

export type CapabilityKind = keyof PackCapabilities;
export type CapabilityChangeType = 'added' | 'removed' | 'changed';

export interface CapabilityChange {
  kind: CapabilityKind;
  change: CapabilityChangeType;
  label: string;
}

const KIND_LABELS: Record<CapabilityKind, string> = {
  guardrails: 'guardrail',
  hooks: 'hook',
  skillFiles: 'skill file',
};
const CAPABILITY_KINDS = Object.keys(KIND_LABELS) as CapabilityKind[];
/** The hook config marketplace bundles take from a source dir (see `readHooksContent`). */
const PLUGIN_HOOKS_FILE = 'claude-hooks.json';
const SKILL_ENTRY = 'SKILL.md';
const MAX_LABEL_CHARS = 120;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function label(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const cut = clean.length > MAX_LABEL_CHARS ? `${clean.slice(0, MAX_LABEL_CHARS)}…` : clean;
  return sanitizeForTerminal(cut);
}

function isPlainFile(path: string): boolean {
  return lstatSync(path).isFile();
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Files under `dir`, recursively; symlinks are skipped (extraction rejects them anyway). */
function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function collectGuardrails(dir: string, into: Map<string, Capability>): void {
  const guardrailsDir = join(dir, 'guardrails');
  for (const name of listDir(guardrailsDir)) {
    const full = join(guardrailsDir, name);
    if (!name.endsWith('.md') || !isPlainFile(full)) continue;
    const content = readFileSync(full, 'utf8');
    let trigger = '?';
    try {
      const { data } = matter(content);
      if (typeof data.trigger === 'string') trigger = data.trigger;
    } catch {
      trigger = 'unparsable frontmatter';
    }
    into.set(name, { hash: sha256(content), label: label(`${name.slice(0, -3)} (gates ${trigger})`) });
  }
}

/** Every `command` string under a value (Claude nests them as `hooks[].hooks[].command`). */
function commandsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(commandsIn);
  if (!isObject(value)) return [];
  const own = typeof value.command === 'string' ? [value.command] : [];
  return [...own, ...Object.values(value).flatMap(commandsIn)];
}

/** One entry per event, hashed over the whole event config (matchers, commands, timeouts). */
function collectHooks(dir: string, into: Map<string, Capability>): void {
  const full = join(dir, PLUGIN_HOOKS_FILE);
  if (!existsSync(full) || !isPlainFile(full)) return;
  const raw = readFileSync(full, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    into.set(PLUGIN_HOOKS_FILE, { hash: sha256(raw), label: label(`${PLUGIN_HOOKS_FILE} (not valid JSON)`) });
    return;
  }
  if (!isObject(json) || !isObject(json.hooks)) {
    into.set(PLUGIN_HOOKS_FILE, { hash: sha256(raw), label: PLUGIN_HOOKS_FILE });
    return;
  }
  for (const [event, config] of Object.entries(json.hooks)) {
    const commands = commandsIn(config).join(' ; ');
    into.set(`${PLUGIN_HOOKS_FILE}#${event}`, {
      hash: sha256(JSON.stringify(config)),
      label: label(`${PLUGIN_HOOKS_FILE}: ${event}${commands ? ` → ${commands}` : ''}`),
    });
  }
}

/** Everything a skill ships besides its `SKILL.md`: scripts of any language, binaries, data. */
function collectSkillFiles(dir: string, into: Map<string, Capability>): void {
  const skillsDir = join(dir, 'skills');
  for (const skill of listDir(skillsDir)) {
    const skillDir = join(skillsDir, skill);
    if (!lstatSync(skillDir).isDirectory() || !existsSync(join(skillDir, SKILL_ENTRY))) continue;
    for (const full of walk(skillDir)) {
      const rel = relative(dir, full).split(sep).join('/');
      if (rel === `skills/${skill}/${SKILL_ENTRY}`) continue;
      into.set(rel, { hash: sha256(readFileSync(full)), label: label(rel) });
    }
  }
}

/**
 * The capabilities in a source dir as sync reads it: a pack's `llm/` dir (or its root when it has
 * none, see `resolvePackSourceDir`), or an external source's cache dir. `null` has none.
 */
export function collectCapabilities(dir: string | null): PackCapabilities {
  const caps: PackCapabilities = { guardrails: new Map(), hooks: new Map(), skillFiles: new Map() };
  if (!dir || !existsSync(dir)) return caps;
  collectGuardrails(dir, caps.guardrails);
  collectHooks(dir, caps.hooks);
  collectSkillFiles(dir, caps.skillFiles);
  return caps;
}

/** What changed between two versions; `before = null` reports everything as added. */
export function diffCapabilities(
  before: PackCapabilities | null,
  after: PackCapabilities,
): CapabilityChange[] {
  const changes: CapabilityChange[] = [];
  for (const kind of CAPABILITY_KINDS) {
    const old = before?.[kind] ?? new Map<string, Capability>();
    const next = after[kind];
    for (const [key, cap] of next) {
      const previous = old.get(key);
      if (!previous) changes.push({ kind, change: 'added', label: cap.label });
      else if (previous.hash !== cap.hash) changes.push({ kind, change: 'changed', label: cap.label });
    }
    for (const [key, cap] of old)
      if (!next.has(key)) changes.push({ kind, change: 'removed', label: cap.label });
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

/** One line per change (`~ guardrail: no-push (gates Bash)`), capped for a hostile pack. */
export function formatCapabilityChanges(changes: readonly CapabilityChange[], indent = '    '): string[] {
  const lines = changes
    .slice(0, MAX_LISTED)
    .map((c) => `${indent}${CHANGE_SIGNS[c.change]} ${KIND_LABELS[c.kind]}: ${c.label}`);
  if (changes.length > MAX_LISTED) lines.push(`${indent}…and ${changes.length - MAX_LISTED} more`);
  return lines;
}

/** How a version compares to the one it replaces. */
export type CapabilityBaseline =
  /** First install of this pack or source: list everything. */
  | { kind: 'new' }
  /** Replacing a version still in the cache: diff against it. */
  | { kind: 'previous'; capabilities: PackCapabilities }
  /** Replacing a version that is not cached (fresh clone, CI): nothing to diff against. */
  | { kind: 'uncached'; version: string };

/**
 * The lines a command logs after installing a version: what it can run or gate, against the version
 * it replaces. Empty when nothing changed. Never throws: an unreadable dir is reported, not fatal,
 * since the install itself already succeeded.
 */
export function capabilityReport(
  name: string,
  baseline: CapabilityBaseline,
  afterDir: string | null,
): string[] {
  let changes: CapabilityChange[];
  try {
    const before = baseline.kind === 'previous' ? baseline.capabilities : null;
    changes = diffCapabilities(before, collectCapabilities(afterDir));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return [`  Warning: could not list what ${name} can run or gate: ${sanitizeForTerminal(reason)}`];
  }
  if (changes.length === 0) return [];
  const heading: Record<CapabilityBaseline['kind'], string> = {
    new: 'can run or gate',
    previous: 'changes what it can run or gate',
    uncached: `can run or gate (the replaced ${baseline.kind === 'uncached' ? baseline.version : ''} is not cached, so this lists everything)`,
  };
  const lines = [`  ${name} ${heading[baseline.kind]}:`, ...formatCapabilityChanges(changes)];
  if (baseline.kind !== 'new' && growsCapabilities(changes)) {
    lines.push('    Review these before syncing: guardrails and hooks run on tool calls automatically.');
  }
  return lines;
}
