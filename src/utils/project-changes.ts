import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    cpSync(root, copy, { recursive: true, filter: (src) => !isUnwalked(src, root) });
    return await measureChanges(copy, procedure);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
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
