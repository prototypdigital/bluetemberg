import { join } from 'node:path';
import type { BlueprintConfig, Platform } from '../types.js';
import { readIfExists } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';

// Gemini CLI loads only the context files named by `context.fileName` (default `GEMINI.md`); it never
// scans a rules directory. Pointing it at AGENTS.md is the whole integration — see Architecture.md
// "Special sync" for why its rules travel in the AGENTS.md managed block.

/** The one value bluetemberg owns in `.gemini/settings.json`: `AGENTS.md` in `context.fileName`. */
const AGENTS_MD = 'AGENTS.md';
/** Gemini CLI's default context file; kept in the list so a hand-written GEMINI.md still loads. */
const GEMINI_MD = 'GEMINI.md';

/** The rules target `init` scaffolded before Gemini moved to AGENTS.md. Gemini CLI never read it. */
export const LEGACY_GEMINI_RULES_DIR = '.gemini/context';

export interface GeminiSettingsSyncContext extends SyncSink {
  platforms: readonly Platform[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns `context.fileName` with AGENTS.md added, `null` when it already lists it, or a string
 * error when the existing value is not a string or array of strings.
 */
function withAgentsMd(fileName: unknown): string[] | null | string {
  if (fileName === undefined) return [AGENTS_MD, GEMINI_MD];
  if (typeof fileName === 'string') return fileName === AGENTS_MD ? null : [fileName, AGENTS_MD];
  if (!Array.isArray(fileName) || !fileName.every((f) => typeof f === 'string')) {
    return 'context.fileName must be a string or an array of strings';
  }
  return fileName.includes(AGENTS_MD) ? null : [...fileName, AGENTS_MD];
}

function parseSettings(raw: string | null): Record<string, unknown> | string {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : 'expected a JSON object';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Adds AGENTS.md to `context.fileName` in `.gemini/settings.json`, creating the file if needed.
 * Every other key is preserved, and a file that already lists AGENTS.md is left byte for byte.
 * A file sync cannot parse is never overwritten: the error asks for the one-line edit instead.
 */
export function syncGeminiSettings(
  ctx: GeminiSettingsSyncContext,
  recordError: (message: string) => void,
): void {
  if (!ctx.platforms.includes('gemini')) return;

  const settingsPath = join(ctx.root, '.gemini', 'settings.json');
  const settings = parseSettings(readIfExists(settingsPath));
  const fail = (detail: string) =>
    recordError(
      `.gemini/settings.json: ${detail}. Fix it, or add "${AGENTS_MD}" to context.fileName by hand.`,
    );
  if (typeof settings === 'string') return fail(settings);

  const context = settings.context ?? {};
  if (!isPlainObject(context)) return fail('"context" must be an object');

  const fileName = withAgentsMd(context.fileName);
  if (fileName === null) return;
  if (typeof fileName === 'string') return fail(fileName);

  const updated = { ...settings, context: { ...context, fileName } };
  commitPlannedWrite(ctx, settingsPath, `${JSON.stringify(updated, null, 2)}\n`);
  if (!ctx.checkMode)
    ctx.log('Gemini settings: AGENTS.md added to context.fileName -> .gemini/settings.json');
}

/**
 * Drops a `targets.rules.gemini` entry that still names the legacy `.gemini/context` directory, so
 * an `init`-scaffolded config stops writing inert files there and `--prune` can clean them up.
 * A custom directory is the user's choice and is kept.
 */
export function dropLegacyGeminiRulesTarget(
  config: BlueprintConfig,
  recordWarning: (message: string) => void,
): BlueprintConfig {
  const rules = config.targets?.rules;
  if (rules?.gemini?.dir !== LEGACY_GEMINI_RULES_DIR) return config;

  const rest = { ...rules };
  delete rest.gemini;
  recordWarning(
    `targets.rules.gemini (${LEGACY_GEMINI_RULES_DIR}) is ignored: Gemini CLI never reads that ` +
      'directory, so its rules now go to AGENTS.md. Remove the entry from bluetemberg.config.json, ' +
      'and run `bluetemberg sync --prune` to delete the old files.',
  );
  return { ...config, targets: { ...config.targets, rules: rest } };
}
