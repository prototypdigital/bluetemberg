import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, sync } from '../sync/index.js';
import { hasGeneratedBanner } from '../sync/banner.js';
import { CLAUDE_HOOKS_MANIFEST } from '../sync/claude-hooks.js';
import { MCP_OWNERSHIP_FILE } from '../sync/mcp.js';
import { readIfExists } from '../utils/fs.js';
import {
  isInside,
  measureChanges,
  measureChangesOnCopy,
  type ProjectChanges,
} from '../utils/project-changes.js';

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

export type UninstallResult = ProjectChanges;

export const CONFIG_FILE = 'bluetemberg.config.json';
export const CACHE_DIR = '.bluetemberg';
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

export async function uninstall(root: string, options: UninstallOptions = {}): Promise<UninstallResult> {
  if (!existsSync(join(root, CONFIG_FILE))) {
    throw new Error(`No ${CONFIG_FILE} found in ${root}, so there is nothing to uninstall.`);
  }
  // The real procedure, run against a throwaway copy, so the report matches what a real run does.
  if (options.dryRun) return measureChangesOnCopy(root, 'bluetemberg-uninstall-', uninstallInPlace);
  return measureChanges(root, uninstallInPlace);
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
  removeIfOnlyLines(root, '.prettierignore', PRETTIERIGNORE_INIT_LINES);
  removeBluetembergState(root, sourceDir);
}

/**
 * The part `uninstall` and `eject` share: the config, the `.bluetemberg/` cache and its `.gitignore`
 * entry, and the machine state under the source dir (including the MCP ownership record). Your own
 * sources under the source dir stay; the dir goes only when nothing else is left in it. A source dir
 * outside the project is left alone.
 */
export function removeBluetembergState(root: string, sourceDir: string): void {
  removeGitignoreCacheEntry(root);
  removeIfBlank(root, '.gitignore');
  // A source dir outside the project (`"source": "../shared/llm"`) is shared with other projects.
  if (isInside(root, sourceDir)) {
    for (const file of STATE_FILES) rmSync(join(sourceDir, file), { force: true });
    removeIfEmptyDir(sourceDir);
  }
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
