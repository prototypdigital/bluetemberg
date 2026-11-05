import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Where drafts live, and the path checks every draft read or write goes through.
 *
 * Drafts sit in `.bluetemberg/drafts/` — the engine's own dir, already gitignored in every project
 * and never read by sync. A draft name is the future rule id, so it is held to a strict kebab-case
 * pattern before it is ever joined into a path: no separators, no dots, no traversal.
 */

export const CACHE_DIR = '.bluetemberg';
export const DRAFTS_SUBDIR = 'drafts';
export const PROMOTED_SUBDIR = 'promoted';
export const MAX_NAME_LENGTH = 64;

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Throws unless `name` is a kebab-case rule id of at most {@link MAX_NAME_LENGTH} characters. */
export function assertDraftName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid draft name ${JSON.stringify(name.slice(0, MAX_NAME_LENGTH))}: use kebab-case ` +
        `(a-z, 0-9, single hyphens), at most ${MAX_NAME_LENGTH} characters`,
    );
  }
}

/** True when `child` is `parent` itself or lies inside it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The drafts dir of `root`. */
export function draftsDir(root: string): string {
  return join(resolve(root), CACHE_DIR, DRAFTS_SUBDIR);
}

/** The archive of promoted drafts. */
export function promotedDir(root: string): string {
  return join(draftsDir(root), PROMOTED_SUBDIR);
}

/** The file of a pending draft. Validates `name` first, so the path cannot leave the drafts dir. */
export function draftPath(root: string, name: string): string {
  assertDraftName(name);
  return join(draftsDir(root), `${name}.md`);
}

/** The archived copy of a promoted draft. */
export function promotedPath(root: string, name: string): string {
  assertDraftName(name);
  return join(promotedDir(root), `${name}.md`);
}

/**
 * Throws when `path` is outside `root`, or any existing segment from `root` down to `path` is a
 * symlink. A symlinked `.bluetemberg/drafts` (or a symlinked draft file) would redirect a read or
 * write anywhere on disk — e.g. a "draft" that is really `llm/rules/x.md`, or a write that lands
 * outside the project.
 */
export function assertNoSymlinks(root: string, path: string): void {
  const base = resolve(root);
  if (!isInside(base, path)) throw new Error(`path is outside the project: ${path}`);
  let current = base;
  for (const segment of relative(base, resolve(path)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing to follow a symlink: ${displayPath(base, current)}`);
    }
  }
}

/** `path` relative to `root`, `/`-separated — for reports. */
export function displayPath(root: string, path: string): string {
  return relative(resolve(root), path).split(sep).join('/');
}
