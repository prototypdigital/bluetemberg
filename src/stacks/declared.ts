import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { Catalog } from '../catalog/index.js';
import type { BlueprintConfig, Stack, StackConstraint } from '../types.js';
import { mergeSourceDirs, mergeSourceFiles, resolveExtendedSourceDirs } from '../sync/extends-loader.js';
import { resolvePackSourceDirs } from '../registry/index.js';
import { resolveExternalSourceDirs } from '../sources/registry.js';
import { buildStackMap, readFrontmatterStacks, resolveStacks } from './resolve.js';

/**
 * Harvest the version ranges that the guidance actually available to a project declares.
 *
 * This is what makes coverage version-aware rather than a name-level boolean: the catalog only
 * knows *which* stacks a pack targets, never at which versions. The versions live in each file's
 * `stacks:` frontmatter, so coverage reads the same source dirs, in the same priority order, and
 * with the same constraint resolution (`frontmatter > catalog pack-level > agnostic`) that the
 * sync gate uses — one implementation of "what applies here", two surfaces.
 *
 * A file that declares `stacks: { react: ">=18 <19" }` contributes that bounded range; a file with
 * no `stacks:` in a pack the catalog tags `["react"]` contributes the wildcard `*`, because it
 * genuinely applies to any React version. Stack-agnostic files contribute nothing.
 */

/** One `(stack, range)` pair declared by an available guidance file. */
export interface DeclaredRange {
  stack: Stack;
  /** The declared semver range, or `"*"` when the file is name-level (pack-tagged, no own range). */
  range: string;
  /** `local` = the project's own source dir; `catalog` = an installed pack, `extends`, or an external source. */
  origin: 'local' | 'catalog';
  /** The declaring file's id (e.g. `rules/effects-r18`), for diagnostics. */
  from: string;
}

/** Markdown content kinds whose files carry a `stacks:` constraint (skills are directories). */
const CONTENT_KINDS = ['rules', 'agents', 'guardrails'] as const;

/** A `README.md` documents a pack; it is never guidance, so it never contributes coverage. */
function isContentFile(filename: string): boolean {
  return filename.endsWith('.md') && filename !== 'README.md';
}

/**
 * The source dirs coverage reads, in sync's priority order: local source → `extends` → installed
 * packs → external sources. Warnings are intentionally dropped here — coverage is a read-only
 * report, and sync already surfaces unresolvable entries.
 */
function coverageSourceDirs(root: string, config: BlueprintConfig): { local: string; dirs: string[] } {
  const source = config.source || 'llm';
  const local = join(root, source);
  const { dirs: extended } = resolveExtendedSourceDirs(config.extends, root);
  const { dirs: packs } = resolvePackSourceDirs(root, source);
  const { dirs: external } = resolveExternalSourceDirs(root, source);
  return { local, dirs: [local, ...extended, ...packs, ...external] };
}

/** Read a file's effective stack constraint (frontmatter wins, else the catalog pack-level tag). */
function readConstraint(
  filePath: string,
  id: string,
  stackMap: Map<string, StackConstraint>,
): StackConstraint {
  try {
    const { data } = matter.read(filePath);
    return resolveStacks(id, readFrontmatterStacks(data as Record<string, unknown>), stackMap);
  } catch {
    // Unreadable frontmatter → fall back to catalog gating; sync reports the read error itself.
    return resolveStacks(id, undefined, stackMap);
  }
}

/**
 * Collect every `(stack, range)` declared by the guidance available at `root`.
 *
 * Files are merged across source dirs with sync's priority semantics, so a local override of a
 * pack rule contributes *its* range, not the pack's — coverage reports what would actually apply.
 */
export function collectDeclaredRanges(
  root: string,
  config: BlueprintConfig,
  catalog: Catalog,
): DeclaredRange[] {
  const { local, dirs } = coverageSourceDirs(root, config);
  const stackMap = buildStackMap(catalog);
  const declared: DeclaredRange[] = [];

  const record = (constraint: StackConstraint, id: string, isLocal: boolean): void => {
    for (const [stack, range] of Object.entries(constraint)) {
      declared.push({ stack, range, origin: isLocal ? 'local' : 'catalog', from: id });
    }
  };

  for (const kind of CONTENT_KINDS) {
    for (const [file, sourceDir] of mergeSourceFiles(dirs, kind, isContentFile)) {
      const id = basename(file, '.md');
      const constraint = readConstraint(join(sourceDir, file), id, stackMap);
      record(constraint, `${kind}/${id}`, sourceDir === join(local, kind));
    }
  }

  const skills = mergeSourceDirs(dirs, 'skills', (dirPath) => existsSync(join(dirPath, 'SKILL.md')));
  for (const [name, sourceParent] of skills) {
    const constraint = readConstraint(join(sourceParent, name, 'SKILL.md'), name, stackMap);
    record(constraint, `skills/${name}`, sourceParent === join(local, 'skills'));
  }

  return declared;
}
