import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Catalog, CatalogPack } from './index.js';

/**
 * Pack-scoped catalog metadata lookup.
 *
 * Catalog metadata (a pack's `profiles`, its `stacks`) must only ever gate **that pack's own
 * files**. Keying it by bare item id (`code-review`, `naming`) let any file with a colliding
 * basename inherit a stranger pack's gating: a project's own `llm/rules/code-review.md` was
 * filtered by a catalog pack it never installed, and two packs sharing an id silently resolved
 * last-write-wins (#249).
 *
 * A file is attributed to a pack by the npm package that owns its source dir — the `package.json`
 * in the dir or, for the conventional `llm/` layout, its parent. That covers every way a pack is
 * sourced: registry cache (`.bluetemberg/packs/<name>/<version>/llm`), npm `extends`
 * (`node_modules/<name>/llm`), and local-path `extends` (`./packages/<name>/llm`). A dir with no
 * owning package, or one whose package is not in the catalog, gets no catalog metadata.
 */
export interface PackItemMap<T> {
  /**
   * Catalog value for item `id` found under `kindDir` (e.g. `<source>/rules`, as returned by
   * `mergeSourceFiles`/`mergeSourceDirs`), or `undefined` when the owning pack does not list it.
   */
  get(kindDir: string, id: string): T | undefined;
}

/** Every item id a pack ships, across all content kinds. */
function packItemIds(pack: CatalogPack): string[] {
  return [...(pack.rules ?? []), ...(pack.agents ?? []), ...(pack.skills ?? []), ...(pack.guardrails ?? [])];
}

/**
 * Build a pack-scoped item map. `valueFor` returns the metadata a pack contributes, or `undefined`
 * to contribute nothing (e.g. a pack with no `stacks`).
 */
export function buildPackItemMap<T>(
  catalog: Catalog,
  valueFor: (pack: CatalogPack) => T | undefined,
): PackItemMap<T> {
  const byPack = new Map<string, Map<string, T>>();
  for (const pack of catalog.packs) {
    const value = valueFor(pack);
    if (value === undefined) continue;
    const items = new Map<string, T>();
    for (const id of packItemIds(pack)) items.set(id, value);
    byPack.set(pack.name, items);
  }

  const ownerCache = new Map<string, string | undefined>();
  const ownerOf = (sourceDir: string): string | undefined => {
    if (!ownerCache.has(sourceDir)) ownerCache.set(sourceDir, readSourcePackName(sourceDir));
    return ownerCache.get(sourceDir);
  };

  return {
    get(kindDir, id) {
      if (byPack.size === 0) return undefined;
      const owner = ownerOf(dirname(kindDir));
      if (owner === undefined) return undefined;
      return byPack.get(owner)?.get(id);
    },
  };
}

/**
 * The npm package name owning a source dir: `<dir>/package.json`, else — when the dir is the
 * conventional `llm/` subdir — `<dir>/../package.json`. `undefined` when neither names a package.
 */
export function readSourcePackName(sourceDir: string): string | undefined {
  const own = readPackageName(join(sourceDir, 'package.json'));
  if (own !== undefined) return own;
  if (basename(sourceDir) !== 'llm') return undefined;
  return readPackageName(join(dirname(sourceDir), 'package.json'));
}

function readPackageName(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const name = (parsed as Record<string, unknown>).name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  } catch {
    // Unparseable package.json → no pack identity → no catalog gating (frontmatter still applies).
    return undefined;
  }
}
