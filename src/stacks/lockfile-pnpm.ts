import { valid } from 'semver';
import { parse } from 'yaml';
import type { Lockfile } from './lockfile.js';
import { isPlainObject, leadingPackageName } from './lockfile-shared.js';

/**
 * `pnpm-lock.yaml` reader (#291). Covers lockfileVersion 5.x (pnpm 7), 6.0 (pnpm 8) and 9.0
 * (pnpm 9–11), as written by pnpm itself:
 *
 *   importers:
 *     packages/web:
 *       dependencies:
 *         next:
 *           specifier: 14.2.3
 *           version: 14.2.3(react-dom@18.3.1(react@18.3.1))(react@18.3.1)
 *
 * A single-project 5.x/6.0 lockfile has no `importers`: the root importer's fields sit at the top
 * level. 5.x stores the version directly (`next: 13.4.0_<peer-hash>`). The `version` already
 * reflects `catalog:` specifiers, `overrides` and `patchedDependencies` (`(patch_hash=…)` suffix).
 *
 * Only the document head (everything before `packages:` / `snapshots:`) is parsed: those two
 * sections hold the transitive graph — most of the file — and are never needed to answer "which
 * version does this importer get". YAML is parsed with `yaml` because pnpm writes real YAML 1.2
 * (single-quoted keys, flow mappings, a leading env document since pnpm 11).
 */

/** The head of a large monorepo's lockfile is well under this; past it, fall back to ranges. */
const MAX_HEAD_CHARS = 16 * 1024 * 1024;

/** Top-level keys after `importers` in every pnpm lockfile — the transitive graph. */
const TAIL_KEY = /^(?:packages|snapshots):/m;

/** Dependency fields an importer records, in pnpm's own precedence. */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/**
 * The project's own lockfile document. pnpm 11 can write a config-dependency "env" document first,
 * separated by `---`; the project lockfile is always the last non-empty document.
 */
function mainDocument(text: string): string {
  const docs = text.split(/^---[ \t]*\r?$/m).filter((doc) => doc.trim() !== '');
  return docs[docs.length - 1] ?? '';
}

function documentHead(doc: string): string {
  const tail = TAIL_KEY.exec(doc);
  return tail ? doc.slice(0, tail.index) : doc;
}

/** The lockfile's major format version (5, 6, 9, …), or null when it is not a pnpm lockfile. */
function lockfileMajor(raw: unknown): number | null {
  const major = typeof raw === 'number' ? Math.floor(raw) : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isInteger(major) && major >= 5 ? major : null;
}

/**
 * The raw `version` an importer records for `pkg`: `undefined` when it does not declare `pkg`,
 * `null` when it does but the entry has no usable version string.
 */
function importerVersion(importer: Record<string, unknown>, pkg: string): string | null | undefined {
  for (const field of DEP_FIELDS) {
    const deps = importer[field];
    if (!isPlainObject(deps) || !Object.hasOwn(deps, pkg)) continue;
    const dep = deps[pkg];
    if (typeof dep === 'string') return dep;
    return isPlainObject(dep) && typeof dep.version === 'string' ? dep.version : null;
  }
  return undefined;
}

/** 5.x: `13.4.0_<peers>`, or an alias as `/name/version_<peers>` (leading `/` already removed). */
function splitV5(ref: string): [string | null, string] {
  const segments = ref.split('/');
  const version = (segments.pop() ?? '').split('_')[0];
  return [segments.length > 0 ? segments.join('/') : null, version];
}

/** 6.0+: `18.3.1(<peers>)` / `(patch_hash=…)`, or an alias as `name@version(<peers>)`. */
function splitV6(ref: string): [string | null, string] {
  const base = ref.split('(')[0];
  if (valid(base)) return [null, base];
  const name = leadingPackageName(base);
  return name ? [name, base.slice(name.length + 1)] : [null, base];
}

/**
 * Turn an importer's raw version into a semver version of `pkg`, or null: a workspace link, a
 * local directory, a tarball or git URL, or an alias to a different package is not a version of
 * `pkg`, so detection falls back to the range rather than reporting another package's version.
 */
export function pnpmVersion(pkg: string, raw: string, major: number): string | null {
  if (/^(?:link|file|workspace):/.test(raw)) return null;
  const ref = raw.startsWith('/') ? raw.slice(1) : raw;
  const [name, version] = major < 6 ? splitV5(ref) : splitV6(ref);
  if (name !== null && name !== pkg) return null;
  return valid(version);
}

export function parsePnpmLock(text: string): Lockfile | null {
  const head = documentHead(mainDocument(text));
  if (head.length > MAX_HEAD_CHARS) {
    throw new Error(`importers section exceeds ${MAX_HEAD_CHARS / (1024 * 1024)} MiB`);
  }
  // pnpm never writes anchors or aliases; refusing them rules out alias-expansion blowups.
  const data: unknown = parse(head, { maxAliasCount: 0 });
  if (!isPlainObject(data)) return null;
  const major = lockfileMajor(data.lockfileVersion);
  if (major === null) return null;
  const importers = isPlainObject(data.importers) ? data.importers : { '.': data };

  return {
    file: 'pnpm-lock.yaml',
    versionOf(pkg, chain) {
      for (const { path } of chain) {
        const key = path || '.';
        const importer = Object.hasOwn(importers, key) ? importers[key] : undefined;
        if (!isPlainObject(importer)) continue;
        const raw = importerVersion(importer, pkg);
        if (raw === undefined) continue;
        // The nearest importer that declares the package decides — never an ancestor's version.
        return raw === null ? null : pnpmVersion(pkg, raw, major);
      }
      return null;
    },
  };
}
