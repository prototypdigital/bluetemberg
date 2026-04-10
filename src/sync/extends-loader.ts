import { existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { listFiles, listDirs } from '../utils/fs.js';

/**
 * Resolves `extends` entries from `bluetemberg.config.json` into absolute source directory paths.
 *
 * Priority order (highest → lowest):
 *   1. Local `source` dir (handled by caller — not returned here)
 *   2. First entry in `extends`
 *   3. Subsequent entries in `extends`
 *
 * Each returned path points to a directory with the same layout as the local `source` dir
 * (i.e. may contain `rules/`, `agents/`, `skills/` subdirectories).
 */
export function resolveExtendedSourceDirs(
  extendsField: string | string[] | undefined,
  root: string,
): string[] {
  if (!extendsField) return [];

  const entries = Array.isArray(extendsField) ? extendsField : [extendsField];

  const resolved: string[] = [];
  for (const entry of entries) {
    const dir = resolveEntry(entry, root);
    if (dir !== null) resolved.push(dir);
  }

  return resolved;
}

function resolveEntry(entry: string, root: string): string | null {
  if (isLocalPath(entry)) {
    return resolveLocalPath(entry, root);
  }
  return resolveNpmPackage(entry, root);
}

function isLocalPath(entry: string): boolean {
  return entry.startsWith('./') || entry.startsWith('../') || isAbsolute(entry);
}

function resolveLocalPath(entry: string, root: string): string | null {
  const base = isAbsolute(entry) ? entry : resolve(root, entry);

  // Prefer {path}/llm/ (conventional source dir name), then {path} directly.
  const withLlm = join(base, 'llm');
  if (existsSync(withLlm)) return withLlm;
  if (existsSync(base)) return base;

  return null;
}

function resolveNpmPackage(name: string, root: string): string | null {
  const pkgBase = join(root, 'node_modules', name);

  const withLlm = join(pkgBase, 'llm');
  if (existsSync(withLlm)) return withLlm;
  if (existsSync(pkgBase)) return pkgBase;

  return null;
}

/**
 * Builds a merged file list from multiple source directories.
 *
 * Files are collected from all dirs using the provided filter. When the same filename appears in
 * more than one directory, the entry from the directory with the **lowest index** wins (higher
 * priority). Callers should pass dirs in priority order: `[local, extended0, extended1, ...]`.
 *
 * @returns Map of filename → absolute directory path containing that file.
 */
export function mergeSourceFiles(
  dirs: string[],
  subdir: string,
  filter: (filename: string) => boolean,
): Map<string, string> {
  const result = new Map<string, string>();

  // Iterate in reverse so higher-priority entries overwrite lower-priority ones.
  for (let i = dirs.length - 1; i >= 0; i--) {
    const subPath = join(dirs[i], subdir);
    for (const file of listFiles(subPath, filter)) {
      result.set(file, subPath);
    }
  }

  return result;
}

/**
 * Builds a merged directory list from multiple source directories.
 * Same priority semantics as {@link mergeSourceFiles}.
 *
 * @returns Map of dir name → absolute parent path containing that directory.
 */
export function mergeSourceDirs(
  dirs: string[],
  subdir: string,
  hasIndex: (dirPath: string) => boolean,
): Map<string, string> {
  const result = new Map<string, string>();

  for (let i = dirs.length - 1; i >= 0; i--) {
    const subPath = join(dirs[i], subdir);
    for (const name of listDirs(subPath)) {
      if (hasIndex(join(subPath, name))) {
        result.set(name, subPath);
      }
    }
  }

  return result;
}
