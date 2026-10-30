import { existsSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { stripLeadingGeneratedBanner } from '../sync/banner.js';
import { AGENTS_RULES_BLOCK_NOTICE } from '../sync/codex.js';
import { loadConfig } from '../sync/index.js';
import {
  AGENTS_RULES_MARKERS,
  CODEX_HOOKS_MARKERS,
  CODEX_MCP_MARKERS,
  unwrapManagedBlock,
  type BlockMarkers,
} from '../sync/managed-block.js';
import { CACHE_DIR, CONFIG_FILE, removeBluetembergState } from '../uninstall/index.js';
import { readIfExists } from '../utils/fs.js';
import {
  isInside,
  measureChanges,
  measureChangesOnCopy,
  UNWALKED,
  type ProjectChanges,
} from '../utils/project-changes.js';

/**
 * `bluetemberg eject`: keep every generated file and drop bluetemberg. The banners come off, the
 * managed-block markers come off (their content stays), and the config, the cache and the state
 * under `llm/` go, so what is left is plain files every AI tool keeps reading and the team owns.
 *
 * Managed JSON entries (`.mcp.json` servers, hooks, the Gemini `context.fileName` value, the
 * marketplace keys) are already plain config, so they stay as they are; only the ownership record
 * that let sync recognize them (`llm/mcp-managed.json`) goes. Guardrail hooks are self-contained
 * `bash -c` scripts that never call the bluetemberg binary, so they keep enforcing after eject.
 * Sources under `llm/` stay: they are files people wrote, and deleting them is a separate choice.
 */

export interface EjectOptions {
  /** Run against a temporary copy and report what would change; the project is not touched. */
  dryRun?: boolean;
}

export type EjectResult = ProjectChanges;

/** Generated outputs carry a banner only in these formats (HTML comment in markdown, `#` in TOML). */
const BANNERED_EXTENSIONS = new Set(['.md', '.mdc', '.toml']);

/** Files sync fences managed blocks into, and the markers each one can hold. */
const MANAGED_BLOCK_FILES: { file: string; markers: BlockMarkers[] }[] = [
  { file: 'AGENTS.md', markers: [AGENTS_RULES_MARKERS] },
  { file: join('.codex', 'config.toml'), markers: [CODEX_MCP_MARKERS, CODEX_HOOKS_MARKERS] },
];

export async function eject(root: string, options: EjectOptions = {}): Promise<EjectResult> {
  if (!existsSync(join(root, CONFIG_FILE))) {
    throw new Error(`No ${CONFIG_FILE} found in ${root}, so there is nothing to eject.`);
  }
  // The real procedure, run against a throwaway copy, so the report matches what a real run does.
  if (options.dryRun) return measureChangesOnCopy(root, 'bluetemberg-eject-', ejectInPlace);
  return measureChanges(root, ejectInPlace);
}

function ejectInPlace(projectRoot: string): void {
  // Real path throughout, so every rewrite is keyed the same way whichever spelling found the file.
  const root = realpathSync(projectRoot);
  const config = loadConfig(root);
  const sourceDir = join(root, config.source || 'llm');

  // Every rewrite is computed before the first write, so malformed markers abort with nothing changed.
  const rewrites = planRewrites(root, sourceDir);
  for (const [path, content] of rewrites) writeFileSync(path, content);
  removeBluetembergState(root, sourceDir);
}

/**
 * New content for each file that loses a banner or managed-block markers, keyed by real path so a
 * symlinked `AGENTS.md` and the file it points at are one entry.
 */
function planRewrites(root: string, sourceDir: string): Map<string, string> {
  const rewrites = new Map<string, string>();
  for (const path of bannerCandidates(root, sourceDir)) {
    const content = readIfExists(path);
    if (content === null) continue;
    const stripped = stripLeadingGeneratedBanner(content);
    if (stripped !== content) rewrites.set(path, stripped);
  }
  for (const { file, markers } of MANAGED_BLOCK_FILES) {
    if (!existsSync(join(root, file))) continue;
    const path = realPathInside(root, file);
    const content = rewrites.get(path) ?? readIfExists(path);
    if (content === null) continue;
    const unwrapped = markers.reduce(
      (text, pair) => unwrapManagedBlock(text, pair, file, dropBlockNotice),
      content,
    );
    if (unwrapped !== content) rewrites.set(path, unwrapped);
  }
  return rewrites;
}

/** Real path of `root/file`, refusing a symlink that leads out of the project: eject edits only its own tree. */
function realPathInside(root: string, file: string): string {
  const path = realpathSync(join(root, file));
  if (isInside(root, path)) return path;
  throw new Error(`${file} links to ${path}, outside the project. Eject does not edit files outside it.`);
}

/** The AGENTS.md rules block opens with a "generated, do not edit" line that no longer holds. */
function dropBlockNotice(inner: string): string {
  if (!inner.startsWith(AGENTS_RULES_BLOCK_NOTICE)) return inner;
  return inner.slice(AGENTS_RULES_BLOCK_NOTICE.length).trim();
}

/**
 * Markdown and TOML files that may carry a banner. Skips the source dir (sources never carry one,
 * and they stay exactly as written), the cache, `.git`, `node_modules`, and nested projects with a
 * config of their own: eject, like sync and uninstall, acts on the given directory only.
 */
function bannerCandidates(root: string, sourceDir: string): string[] {
  const skipped = new Set([sourceDir, join(root, CACHE_DIR)]);
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isFile() && BANNERED_EXTENSIONS.has(extname(ent.name))) files.push(path);
      if (!ent.isDirectory() || skipped.has(path)) continue;
      if (dir === root && UNWALKED.has(ent.name)) continue;
      if (existsSync(join(path, CONFIG_FILE))) continue;
      visit(path);
    }
  };
  visit(root);
  return files;
}
