import { existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { listFiles, listDirs } from '../utils/fs.js';
import type { BlueprintConfig, Platform } from '../types.js';
import { normalizePlatforms } from './targets.js';

/** An `extends` entry, normalized. `platforms` is `null` when the entry applies to every platform. */
export interface ExtendsSpec {
  path: string;
  platforms: Platform[] | null;
}

/** A resolved `extends` entry: the source dir it points at, and the platforms it applies to. */
export interface ResolvedExtendsEntry extends ExtendsSpec {
  dir: string;
}

export interface ResolvedExtends {
  /** Every resolved dir, in priority order, whatever its scope. */
  dirs: string[];
  /** The same entries with their scope; `entries[i].dir === dirs[i]`. */
  entries: ResolvedExtendsEntry[];
  warnings: string[];
}

/**
 * Normalize an `extends` field into one spec per path, in priority order. A path listed more than
 * once keeps its first (highest-priority) position, and its scopes are unioned: a plain string, or
 * any unscoped occurrence, makes it apply to every platform. So a duplicate can only widen a scope;
 * to narrow one, remove the broader entry. `windsurf` in a scope is read as `devin`.
 */
export function normalizeExtends(extendsField: BlueprintConfig['extends']): ExtendsSpec[] {
  if (!extendsField) return [];
  const entries = Array.isArray(extendsField) ? extendsField : [extendsField];
  const byPath = new Map<string, ExtendsSpec>();

  for (const entry of entries) {
    const path = typeof entry === 'string' ? entry : entry.path;
    const platforms = typeof entry === 'string' ? null : normalizePlatforms(entry.platforms);
    const seen = byPath.get(path);
    if (!seen) {
      byPath.set(path, { path, platforms });
      continue;
    }
    seen.platforms =
      seen.platforms === null || platforms === null
        ? null
        : normalizePlatforms([...seen.platforms, ...platforms]);
  }

  return [...byPath.values()];
}

/** Write normalized specs back in config form: a plain string for an unscoped entry. */
export function toExtendsEntries(specs: readonly ExtendsSpec[]): NonNullable<BlueprintConfig['extends']> {
  return specs.map((spec) =>
    spec.platforms === null ? spec.path : { path: spec.path, platforms: spec.platforms },
  );
}

/** Whether a normalized entry is merged when syncing `platform`. */
export function extendsAppliesTo(spec: ExtendsSpec, platform: Platform): boolean {
  if (spec.platforms === null) return true;
  return spec.platforms.includes(normalizePlatforms([platform])[0]);
}

/**
 * Resolves `extends` entries from `bluetemberg.config.json` into absolute source directory paths.
 *
 * Priority order (highest → lowest):
 *   1. Local `source` dir (handled by caller — not returned here)
 *   2. First entry in `extends`
 *   3. Subsequent entries in `extends`
 *
 * Each returned path points to a directory with the same layout as the local `source` dir
 * (i.e. may contain `rules/`, `agents/`, `skills/` subdirectories). Every entry is resolved
 * whatever its platform scope; callers that sync per platform filter `entries` by scope.
 *
 * Unresolvable entries produce a warning instead of silently being skipped.
 */
export function resolveExtendedSourceDirs(
  extendsField: BlueprintConfig['extends'],
  root: string,
): ResolvedExtends {
  const entries: ResolvedExtendsEntry[] = [];
  const warnings: string[] = [];

  for (const spec of normalizeExtends(extendsField)) {
    const dir = resolveEntry(spec.path, root);
    if (dir !== null) {
      entries.push({ ...spec, dir });
    } else {
      warnings.push(`extends entry "${spec.path}" could not be resolved — path or package not found`);
    }
  }

  return { dirs: entries.map((e) => e.dir), entries, warnings };
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

/** A content name shipped by more than one source dir; `winner` is the one that applies. */
export interface ShadowedEntry {
  name: string;
  /** Index (into the priority-ordered dirs) of the source whose copy applies. */
  winner: number;
  /** Indexes of the sources whose copies are silently ignored. */
  losers: number[];
}

/**
 * Find names that more than one source dir provides under `subdir` — the collisions
 * {@link mergeSourceFiles} / {@link mergeSourceDirs} resolve by priority without saying so.
 * `list` enumerates the entries of one `<dir>/<subdir>` path.
 */
export function findShadowedEntries(
  dirs: string[],
  subdir: string,
  list: (subPath: string) => string[],
): ShadowedEntry[] {
  const providers = new Map<string, number[]>();
  dirs.forEach((dir, i) => {
    for (const name of list(join(dir, subdir))) {
      providers.set(name, [...(providers.get(name) ?? []), i]);
    }
  });
  return [...providers.entries()]
    .filter(([, idx]) => idx.length > 1)
    .map(([name, [winner, ...losers]]) => ({ name, winner, losers }));
}
