import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, sync } from '../sync/index.js';
import { hasGeneratedBanner } from '../sync/banner.js';
import { CLAUDE_HOOKS_MANIFEST } from '../sync/claude-hooks.js';
import { MCP_OWNERSHIP_FILE } from '../sync/mcp.js';
import { readIfExists } from '../utils/fs.js';

/**
 * `bluetemberg uninstall`: remove everything bluetemberg generated or manages and keep everything a
 * person wrote. Most of the work is a sync against an empty staged source with `prune` on, so each
 * emitter's own "source is gone" path does the removal: bannered files, managed blocks, managed MCP
 * servers, guardrail hooks and the bluetemberg-owned `hooks` key. The residual steps cover output a
 * normal sync keeps on purpose because deleting it would be wrong while bluetemberg is in use.
 */

export interface UninstallOptions {
  /** Run against a temporary copy and report what would change; the project is not touched. */
  dryRun?: boolean;
}

export interface UninstallResult {
  /** Paths relative to the project root that were (or would be) deleted. */
  removed: string[];
  /** Paths relative to the project root that were (or would be) edited in place. */
  edited: string[];
}

const CONFIG_FILE = 'bluetemberg.config.json';
const CACHE_DIR = '.bluetemberg';
const STAGING_DIR = `${CACHE_DIR}/uninstall`;
/** Machine state under the source dir: written by bluetemberg commands, not by people. */
const STATE_FILES = [
  'packages.json',
  'packages-lock.json',
  'mcp.json',
  MCP_OWNERSHIP_FILE,
  'rule-sources.json',
  'rule-sources-lock.json',
];
/** Outputs sync writes whole (no merge, no banner), keyed by the source file that produces them. */
const WHOLE_FILE_OUTPUTS: { source: string; output: string }[] = [
  { source: 'mcp.json', output: join('.cursor', 'mcp.json') },
  { source: 'hooks.json', output: join('.cursor', 'hooks.json') },
];
const GITIGNORE_CACHE_LINES = new Set(['# Bluetemberg cache', '.bluetemberg/']);
/** What `init` writes to `.prettierignore`; a file holding nothing else is removed. */
const PRETTIERIGNORE_INIT_LINES = new Set(['llm/', 'docs/wiki/', 'plugins/']);
/** Never snapshotted: large, and never touched by uninstall. */
const UNWALKED = new Set(['.git', 'node_modules']);

export async function uninstall(root: string, options: UninstallOptions = {}): Promise<UninstallResult> {
  if (!existsSync(join(root, CONFIG_FILE))) {
    throw new Error(`No ${CONFIG_FILE} found in ${root}, so there is nothing to uninstall.`);
  }
  if (options.dryRun) return dryRun(root);

  const before = snapshot(root);
  await uninstallInPlace(root);
  return diffSnapshots(before, snapshot(root));
}

/** The real procedure, run against a throwaway copy, so the report matches what a real run does. */
async function dryRun(root: string): Promise<UninstallResult> {
  const copy = mkdtempSync(join(tmpdir(), 'bluetemberg-uninstall-'));
  try {
    cpSync(root, copy, { recursive: true, filter: (src) => !isUnwalked(src, root) });
    const before = snapshot(copy);
    await uninstallInPlace(copy);
    return diffSnapshots(before, snapshot(copy));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

async function uninstallInPlace(root: string): Promise<void> {
  const config = loadConfig(root);
  const sourceDir = join(root, config.source || 'llm');

  stageEmptySource(root, sourceDir);
  try {
    const results = await sync(root, {
      config: { ...config, source: STAGING_DIR, extends: [] },
      prune: true,
      silent: true,
      recursive: false,
    });
    if (results.errors.length > 0) {
      throw new Error(`Sync could not clear the generated output:\n  ${results.errors.join('\n  ')}`);
    }
  } finally {
    rmSync(join(root, STAGING_DIR), { recursive: true, force: true });
  }

  if (config.platforms?.includes('claude-marketplace')) removeMarketplace(root);
  removeGeneratedFile(root, join('.github', 'copilot-instructions.md'));
  removeAgentsMdFromGemini(root);
  removeIfBlank(root, join('.codex', 'config.toml'));
  for (const { source, output } of WHOLE_FILE_OUTPUTS) {
    if (existsSync(join(sourceDir, source))) rmSync(join(root, output), { force: true });
  }
  removeGitignoreCacheEntry(root);
  removeIfBlank(root, '.gitignore');
  removeIfOnlyLines(root, '.prettierignore', PRETTIERIGNORE_INIT_LINES);
  for (const file of STATE_FILES) rmSync(join(sourceDir, file), { force: true });
  removeIfEmptyDir(sourceDir);
  rmSync(join(root, CACHE_DIR), { recursive: true, force: true });
  rmSync(join(root, CONFIG_FILE), { force: true });
}

/**
 * An empty source that still carries the ownership state sync needs to recognize its own output:
 * the managed-MCP record, and an empty hooks manifest when the project had one, so sync clears the
 * `hooks` key it owned instead of leaving the last synced hooks running.
 */
function stageEmptySource(root: string, sourceDir: string): void {
  const staging = join(root, STAGING_DIR);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const ownership = join(sourceDir, MCP_OWNERSHIP_FILE);
  if (existsSync(ownership)) copyFileSync(ownership, join(staging, MCP_OWNERSHIP_FILE));
  if (existsSync(join(sourceDir, CLAUDE_HOOKS_MANIFEST))) {
    writeFileSync(join(staging, CLAUDE_HOOKS_MANIFEST), '{ "hooks": {} }\n');
  }
}

/**
 * The marketplace manifest is written whole, so it goes; its `name` identifies the entries sync
 * merged into `.claude/settings.json` (`extraKnownMarketplaces.<name>`, `enabledPlugins` ending in
 * `@<name>`), and only those are taken out. Other marketplaces and keys stay.
 */
function removeMarketplace(root: string): void {
  const manifestPath = join(root, '.claude-plugin', 'marketplace.json');
  const name = parseObject(readIfExists(manifestPath))?.name;
  rmSync(manifestPath, { force: true });
  removeIfEmptyDir(join(root, '.claude-plugin'));
  if (typeof name !== 'string') return;

  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = parseObject(readIfExists(settingsPath));
  if (!settings) return;
  const updated = { ...settings };
  const marketplaces = withoutKeys(settings.extraKnownMarketplaces, (key) => key === name);
  const plugins = withoutKeys(settings.enabledPlugins, (key) => key.endsWith(`@${name}`));
  setOrDelete(updated, 'extraKnownMarketplaces', marketplaces);
  setOrDelete(updated, 'enabledPlugins', plugins);
  if (JSON.stringify(updated) === JSON.stringify(settings)) return;
  writeFileSync(settingsPath, `${JSON.stringify(updated, null, 2)}\n`);
}

/** `value` without the keys `drop` matches; `undefined` (leave the key alone) when it isn't an object. */
function withoutKeys(value: unknown, drop: (key: string) => boolean): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !drop(key)));
}

function setOrDelete(
  target: Record<string, unknown>,
  key: string,
  value: Record<string, unknown> | undefined,
): void {
  if (value === undefined) return;
  if (Object.keys(value).length === 0) delete target[key];
  else target[key] = value;
}

/** Sync regenerates this AGENTS.md copy for as long as AGENTS.md exists; it is still ours. */
function removeGeneratedFile(root: string, rel: string): void {
  const content = readIfExists(join(root, rel));
  if (content !== null && hasGeneratedBanner(content)) rmSync(join(root, rel));
}

/**
 * Takes out the one value bluetemberg owns in `.gemini/settings.json`. When what is left is exactly
 * what bluetemberg created (Gemini's default `GEMINI.md` and nothing else), the file goes too.
 */
function removeAgentsMdFromGemini(root: string): void {
  const path = join(root, '.gemini', 'settings.json');
  const settings = parseObject(readIfExists(path));
  if (!settings) return;
  const context = settings.context;
  if (!isPlainObject(context) || !Array.isArray(context.fileName)) return;
  if (!context.fileName.includes('AGENTS.md')) return;

  const fileName = context.fileName.filter((f) => f !== 'AGENTS.md');
  const otherContextKeys = Object.keys(context).filter((k) => k !== 'fileName');
  const otherKeys = Object.keys(settings).filter((k) => k !== 'context');
  const onlyDefaultLeft = fileName.length === 1 && fileName[0] === 'GEMINI.md';
  if (onlyDefaultLeft && otherContextKeys.length === 0 && otherKeys.length === 0) {
    rmSync(path);
    removeIfEmptyDir(join(root, '.gemini'));
    return;
  }
  const updated = { ...settings, context: { ...context, fileName } };
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
}

/** Drops the `.bluetemberg/` cache entry and its comment. The `.npmrc` entry stays: it guards tokens. */
function removeGitignoreCacheEntry(root: string): void {
  const path = join(root, '.gitignore');
  const content = readIfExists(path);
  if (content === null) return;
  const lines = content.split('\n');
  const kept = lines.filter((line) => !GITIGNORE_CACHE_LINES.has(line.trim()));
  if (kept.length === lines.length) return;
  writeFileSync(path, kept.join('\n').replace(/\n{3,}/g, '\n\n'));
}

function removeIfBlank(root: string, rel: string): void {
  const content = readIfExists(join(root, rel));
  if (content === null || content.trim() !== '') return;
  rmSync(join(root, rel));
  removeIfEmptyDir(join(root, rel, '..'));
}

/** Removes a file whose non-blank lines all come from `owned`; a file with anything else is kept whole. */
function removeIfOnlyLines(root: string, rel: string, owned: ReadonlySet<string>): void {
  const content = readIfExists(join(root, rel));
  if (content === null) return;
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.every((line) => owned.has(line))) rmSync(join(root, rel));
}

function removeIfEmptyDir(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUnwalked(path: string, root: string): boolean {
  const rel = path.slice(root.length + 1);
  return UNWALKED.has(rel.split(/[\\/]/)[0] ?? '');
}

/** Every file under `root` (dotfiles included) mapped to a content hash, skipping `.git` and `node_modules`. */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (rel: string) => {
    for (const ent of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = rel ? join(rel, ent.name) : ent.name;
      if (!rel && UNWALKED.has(ent.name)) continue;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile()) files.set(child, hashFile(join(root, child)));
    }
  };
  visit('');
  return files;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function diffSnapshots(before: Map<string, string>, after: Map<string, string>): UninstallResult {
  const removed: string[] = [];
  const edited: string[] = [];
  for (const [path, hash] of before) {
    const now = after.get(path);
    if (now === undefined) removed.push(path);
    else if (now !== hash) edited.push(path);
  }
  return { removed: removed.sort(), edited: edited.sort() };
}
