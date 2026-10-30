import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BlueprintConfig } from '../types.js';
import { resolveExtendedSourceDirs, mergeSourceDirs, mergeSourceFiles } from './extends-loader.js';
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
  const extendsEntries = toList(config.extends);
  const extended = resolveExtendedSourceDirs(config.extends, root);
  const packs = resolvePackSourceDirs(root, source);
  const external = resolveExternalSourceDirs(root, source);

  const sources: SyncSource[] = [
    { dir: sourceBase, origin: 'local', label: 'local' },
    // `extends` drops unresolvable entries, so labels are matched by position only when none dropped.
    ...extended.dirs.map((dir, i) => ({
      dir,
      origin: 'extends' as const,
      label:
        extended.dirs.length === extendsEntries.length ? `extends ${extendsEntries[i]}` : `extends[${i}]`,
    })),
    ...packs.dirs.map((dir, i) => ({ dir, origin: 'pack' as const, label: packs.labels[i] ?? `pack[${i}]` })),
    ...external.dirs.map((dir, i) => ({
      dir,
      origin: 'external' as const,
      label: external.labels[i] ?? `external[${i}]`,
    })),
  ];

  return {
    sourceBase,
    extendedDirs: extended.dirs,
    packDirs: packs.dirs,
    externalDirs: external.dirs,
    sources,
    warnings: [...extended.warnings, ...packs.warnings, ...external.warnings],
  };
}

function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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
