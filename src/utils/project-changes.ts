import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * Measures what a whole-project procedure (`uninstall`, `eject`) changes by hashing every file
 * before and after it runs. Running the same procedure on a throwaway copy is how their dry runs
 * report exactly what a real run would do, without a second, drift-prone planning path.
 */

export interface ProjectChanges {
  /** Paths relative to the project root that were (or would be) deleted. */
  removed: string[];
  /** Paths relative to the project root that were (or would be) edited in place. */
  edited: string[];
}

/** Never snapshotted or copied: large, and never touched by these procedures. */
export const UNWALKED = new Set(['.git', 'node_modules']);

/** Runs `procedure` on `root` and returns the files it removed or edited. */
export async function measureChanges(
  root: string,
  procedure: (root: string) => Promise<void> | void,
): Promise<ProjectChanges> {
  const before = snapshot(root);
  await procedure(root);
  return diffSnapshots(before, snapshot(root));
}

/** Runs `procedure` on a temporary copy of `root`; the project itself is not touched. */
export async function measureChangesOnCopy(
  root: string,
  tempPrefix: string,
  procedure: (root: string) => Promise<void> | void,
): Promise<ProjectChanges> {
  const copy = mkdtempSync(join(tmpdir(), tempPrefix));
  try {
    // verbatimSymlinks: by default cpSync rewrites a relative link as an absolute path into `root`,
    // so a dry run writing through `AGENTS.md -> CLAUDE.md` would edit the real project.
    cpSync(root, copy, { recursive: true, verbatimSymlinks: true, filter: (src) => !isUnwalked(src, root) });
    retargetLinksIntoCopy(root, copy);
    return await measureChanges(copy, procedure);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Points absolute symlinks that target a path inside `root` at the same path inside `copy`. */
function retargetLinksIntoCopy(root: string, copy: string): void {
  const visit = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) visit(path);
      if (!ent.isSymbolicLink()) continue;
      const target = readlinkSync(path);
      if (!isAbsolute(target) || !isInside(root, target)) continue;
      rmSync(path);
      symlinkSync(join(copy, relative(root, target)), path);
    }
  };
  visit(copy);
}

/** True when `path` is `root` itself or below it. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
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

function diffSnapshots(before: Map<string, string>, after: Map<string, string>): ProjectChanges {
  const removed: string[] = [];
  const edited: string[] = [];
  for (const [path, hash] of before) {
    const now = after.get(path);
    if (now === undefined) removed.push(path);
    else if (now !== hash) edited.push(path);
  }
  return { removed: removed.sort(), edited: edited.sort() };
}
