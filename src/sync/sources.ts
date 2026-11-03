import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BlueprintConfig, Platform } from '../types.js';
import {
  resolveExtendedSourceDirs,
  mergeSourceDirs,
  mergeSourceFiles,
  extendsAppliesTo,
  type ResolvedExtendsEntry,
} from './extends-loader.js';
import { configuredPlatforms, normalizePlatforms } from './targets.js';
import { resolvePackSourceDirs } from '../registry/index.js';
import { resolveExternalSourceDirs } from '../sources/registry.js';

/**
 * Where sync reads content from, and how it enumerates each content kind. Shared by sync and
 * `bluetemberg why` so the diagnostic sees exactly the files, in exactly the priority order, that
 * sync does.
 */

export type SourceOrigin = 'local' | 'extends' | 'pack' | 'external';

export interface SyncSource {
  dir: string;
  origin: SourceOrigin;
  /** `local`, the `extends` entry as written, `name@version` for a pack, `key@ref` for a source. */
  label: string;
  /** Platforms a scoped `extends` entry applies to; `null` (every other source) = every platform. */
  platforms: Platform[] | null;
}

/** A set of platforms that read the same sources: everything but scoped `extends` entries is shared. */
export interface SourceView {
  platforms: Platform[];
  sources: SyncSource[];
}

export interface ResolvedSyncSources {
  sourceBase: string;
  extendedDirs: string[];
  packDirs: string[];
  externalDirs: string[];
  /** Every source in priority order: local, then `extends`, then packs, then external sources. */
  sources: SyncSource[];
  /** Resolution warnings, in the order sync reports them (extends, packs, external). */
  warnings: string[];
}

/** Resolve the source dirs sync reads, in priority order, with a label for each. */
export function resolveSyncSources(root: string, config: BlueprintConfig): ResolvedSyncSources {
  const source = config.source || 'llm';
  const sourceBase = join(root, source);
  const extended = resolveExtendedSourceDirs(config.extends, root);
  const packs = resolvePackSourceDirs(root, source);
  const external = resolveExternalSourceDirs(root, source);
  const configured = configuredPlatforms(config);

  const sources: SyncSource[] = [
    { dir: sourceBase, origin: 'local', label: 'local', platforms: null },
    ...extended.entries.map((entry) => ({
      dir: entry.dir,
      origin: 'extends' as const,
      label: extendsLabel(entry),
      platforms: entry.platforms,
    })),
    ...packs.dirs.map((dir, i) => ({
      dir,
      origin: 'pack' as const,
      label: packs.labels[i] ?? `pack[${i}]`,
      platforms: null,
    })),
    ...external.dirs.map((dir, i) => ({
      dir,
      origin: 'external' as const,
      label: external.labels[i] ?? `external[${i}]`,
      platforms: null,
    })),
  ];

  return {
    sourceBase,
    extendedDirs: extended.dirs,
    packDirs: packs.dirs,
    externalDirs: external.dirs,
    sources,
    warnings: [
      ...extended.warnings,
      ...deadScopeWarnings(extended.entries, configured),
      ...packs.warnings,
      ...external.warnings,
    ],
  };
}

function extendsLabel(entry: ResolvedExtendsEntry): string {
  const scope = entry.platforms === null ? '' : ` (${entry.platforms.join(', ')} only)`;
  return `extends ${entry.path}${scope}`;
}

/** A scoped entry none of whose platforms is configured is never synced anywhere: say so. */
function deadScopeWarnings(
  entries: readonly ResolvedExtendsEntry[],
  configured: readonly Platform[],
): string[] {
  return entries
    .filter((entry) => !configured.some((p) => extendsAppliesTo(entry, p)))
    .map(
      (entry) =>
        `extends entry "${entry.path}" is scoped to ${(entry.platforms ?? []).join(', ')}, none of which is in "platforms", so it is never synced`,
    );
}

/** Whether `source` is read when syncing `platform`. */
export function sourceAppliesTo(source: SyncSource, platform: Platform): boolean {
  return source.platforms === null || source.platforms.includes(normalizePlatforms([platform])[0]);
}

/** The sources at least one of `platforms` reads: a scoped entry for none of them is dropped. */
export function activeSources(sources: readonly SyncSource[], platforms: readonly Platform[]): SyncSource[] {
  return sources.filter((s) => platforms.some((p) => sourceAppliesTo(s, p)));
}

/**
 * Group `platforms` by the sources they read. With no scoped `extends` entry (or when every scope
 * covers every configured platform) there is one view holding every source, which is exactly what
 * sync read before scopes existed. Views keep the order of `platforms`; each view's sources keep
 * priority order.
 */
export function resolveSourceViews(
  sources: readonly SyncSource[],
  platforms: readonly Platform[],
): SourceView[] {
  const views = new Map<string, SourceView>();
  for (const platform of platforms) {
    const visible = sources.filter((s) => sourceAppliesTo(s, platform));
    const key = visible.map((s) => s.dir).join('\0');
    const view = views.get(key);
    if (view) view.platforms.push(platform);
    else views.set(key, { platforms: [platform], sources: visible });
  }
  return [...views.values()];
}

export type ContentKind = 'rules' | 'agents' | 'skills' | 'guardrails';

export const CONTENT_KINDS: readonly ContentKind[] = ['rules', 'agents', 'skills', 'guardrails'];

/**
 * Merge one content kind across `dirs` with sync's priority semantics. Keys are the file name
 * (`x.md`) for rules/agents/guardrails and the directory name for skills; values are the dir the
 * winning copy was found in (`<source>/rules`, or `<source>/skills` for skills).
 */
export function mergeContentKind(dirs: string[], kind: ContentKind): Map<string, string> {
  if (kind === 'skills') return mergeSourceDirs(dirs, 'skills', (p) => existsSync(join(p, 'SKILL.md')));
  const isAgentReadme = (f: string): boolean => kind === 'agents' && f === 'README.md';
  return mergeSourceFiles(dirs, kind, (f) => f.endsWith('.md') && !isAgentReadme(f));
}

/**
 * Group source views by what one content kind merges to: views whose sources yield the same
 * `kind` files (same names from the same dirs) form one group, holding all their platforms and the
 * sources of the first. A kind step runs once per group, so platforms that differ only in, say,
 * their skills still share one rules pass, and an output they share holds one set of rules.
 */
export function groupViewsByKind(views: readonly SourceView[], kind: ContentKind): SourceView[] {
  const groups = new Map<string, SourceView>();
  for (const view of views) {
    const merged = mergeContentKind(
      view.sources.map((s) => s.dir),
      kind,
    );
    const key = JSON.stringify([...merged.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const group = groups.get(key);
    if (group) group.platforms.push(...view.platforms);
    else groups.set(key, { platforms: [...view.platforms], sources: view.sources });
  }
  return [...groups.values()];
}
