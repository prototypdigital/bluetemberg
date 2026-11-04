import { valid } from 'semver';
import type { Lockfile, LockfileContext, LockfileImporter } from './lockfile.js';
import { aliasesOtherPackage, isPlainObject, leadingPackageName } from './lockfile-shared.js';

/**
 * `yarn.lock` reader (#291), both formats, with one small line reader and no YAML dependency.
 *
 * yarn v1 (classic) writes its own format, not YAML:
 *
 *   react-dom@^18.2.0, react-dom@^18.3.0:
 *     version "18.3.1"
 *
 * yarn berry (2+) writes a YAML subset, marked by a `__metadata` entry:
 *
 *   "react-dom@npm:^18.2.0, react-dom@npm:^18.3.0":
 *     version: 18.3.1
 *     resolution: "react-dom@npm:18.3.1"
 *
 * Both are flat: one entry per resolution, keyed by every descriptor that resolved to it, with
 * two-space indented fields. Only `version`, `resolution`, `linkType` and — for berry workspace
 * entries — `dependencies` are read; deeper nesting is skipped. A full YAML parser was measured
 * at ~3 s/MB on berry lockfiles (a 40 MB file took two minutes), so berry does not use one.
 *
 * Neither format records which workspace asked for a descriptor, so a direct dependency maps to
 * its entry through the descriptor itself: v1 by `name@<range from package.json>`, berry through
 * the workspace's own entry (`web@workspace:packages/web` lists its descriptors).
 */

interface YarnEntry {
  /** Every descriptor in the entry's header. */
  specs: string[];
  version?: string;
  resolution?: string;
  linkType?: string;
  /** Berry workspace entries only: dependency name → descriptor (devDependencies included). */
  dependencies?: Map<string, string>;
}

interface ParsedEntries {
  bySpec: Map<string, YarnEntry>;
  entries: YarnEntry[];
}

/** Index of the double quote closing the JSON string that opens at `start`. */
function closingQuote(s: string, start: number): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  throw new Error('unterminated string');
}

/** Read a leading scalar: a JSON-quoted string, or plain text up to the first `stop` character. */
function readScalar(s: string, stops: string): [string, number] {
  if (s.startsWith('"')) {
    const end = closingQuote(s, 0);
    return [JSON.parse(s.slice(0, end + 1)) as string, end + 1];
  }
  let end = 0;
  while (end < s.length && !stops.includes(s[end])) end++;
  return [s.slice(0, end), end];
}

function unquote(value: string): string {
  return value.startsWith('"') ? (JSON.parse(value) as string) : value;
}

/** Split an entry header (without its trailing `:`) into descriptors. */
function parseHeader(header: string): string[] {
  const specs: string[] = [];
  let rest = header;
  while (rest !== '') {
    const [token, end] = readScalar(rest, ',');
    specs.push(...token.split(', ').map((spec) => spec.trim()));
    rest = rest.slice(end);
    if (rest === '') break;
    if (!rest.startsWith(', ')) throw new Error(`unexpected "${rest.slice(0, 20)}" in entry header`);
    rest = rest.slice(2);
  }
  return specs.filter(Boolean);
}

/** One indented field: `key value` (v1) or `key: value` (berry). A nested map's header has no value. */
function parseField(line: string, berry: boolean): [string, string | undefined] {
  const [key, end] = readScalar(line, berry ? ':' : ' :');
  let rest = line.slice(end);
  if (rest.startsWith(':')) rest = rest.slice(1);
  else if (berry) throw new Error(`expected ":" after "${key}"`);
  rest = rest.trim();
  return [key, rest === '' ? undefined : unquote(rest)];
}

const ENTRY_FIELDS = ['version', 'resolution', 'linkType'] as const;

function isEntryField(key: string): key is (typeof ENTRY_FIELDS)[number] {
  return (ENTRY_FIELDS as readonly string[]).includes(key);
}

/** Read every entry. Throws on a line that fits neither format (a merge-conflict marker, say). */
function readEntries(text: string, berry: boolean): ParsedEntries {
  const bySpec = new Map<string, YarnEntry>();
  const entries: YarnEntry[] = [];
  let current: YarnEntry | null = null;
  let collectDeps = false;
  let nested: Map<string, string> | null = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - trimmed.length;
    try {
      if (indent === 0) {
        if (!line.endsWith(':')) throw new Error('expected an entry header');
        const specs = parseHeader(line.slice(0, -1));
        current = { specs };
        entries.push(current);
        for (const spec of specs) bySpec.set(spec, current);
        collectDeps = berry && specs.some((spec) => spec.includes('@workspace:'));
        nested = null;
        continue;
      }
      if (!current) throw new Error('indented line outside an entry');
      if (indent === 2) {
        const [key, value] = parseField(trimmed, berry);
        nested = null;
        if (value !== undefined && isEntryField(key)) current[key] = value;
        if (value === undefined && key === 'dependencies' && collectDeps) {
          nested = new Map();
          current.dependencies = nested;
        }
        continue;
      }
      if (indent === 4 && nested) {
        const [key, value] = parseField(trimmed, berry);
        if (value !== undefined) nested.set(key, value);
      }
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { bySpec, entries };
}

function v1Lockfile({ bySpec }: ParsedEntries): Lockfile {
  return {
    file: 'yarn.lock',
    versionOf(pkg, chain) {
      // v1 never lists workspaces, so the importer's own package.json range is the descriptor.
      const declared = chain.find((importer) => importer.range !== undefined)?.range;
      if (declared === undefined || aliasesOtherPackage(pkg, declared)) return null;
      return valid(bySpec.get(`${pkg}@${declared}`)?.version ?? '');
    },
  };
}

/** Berry adds the default `npm:` protocol to a bare range when it writes a descriptor. */
function berryDescriptor(range: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(range) ? range : `npm:${range}`;
}

/** A berry workspace entry: its package name (for parent-scoped resolutions) and descriptors. */
interface BerryWorkspace {
  name: string;
  dependencies: Map<string, string>;
}

/** The workspace path in a `name@workspace:<path>` resolution, or null for any other entry. */
function workspacePath(resolution: string | undefined): string | null {
  const name = resolution ? leadingPackageName(resolution) : null;
  if (!name || !resolution) return null;
  const rest = resolution.slice(name.length + 1);
  return rest.startsWith('workspace:') ? rest.slice('workspace:'.length) : null;
}

/** One `name[@range]` part of a resolutions key, and what follows it. */
interface KeyPart {
  name: string;
  range: string | undefined;
  rest: string;
}

function readKeyPart(key: string): KeyPart | null {
  const nameStart = key.startsWith('@') ? key.indexOf('/') + 1 : 0;
  if (key.startsWith('@') && nameStart === 0) return null;
  let end = nameStart;
  while (end < key.length && key[end] !== '@' && key[end] !== '/') end++;
  const name = key.slice(0, end);
  if (key[end] !== '@') return { name, range: undefined, rest: key.slice(end) };
  const slash = key.indexOf('/', end);
  const rangeEnd = slash < 0 ? key.length : slash;
  return { name, range: key.slice(end + 1, rangeEnd), rest: key.slice(rangeEnd) };
}

/**
 * A `resolutions` key as yarn berry parses it: `[parent[@range]/]name[@range]`. Glob keys
 * (`**\/react`) were removed in yarn 2 — yarn 4 warns (YN0057) and ignores them — so they parse
 * to null and never apply.
 */
function parseResolutionKey(key: string): { parent: KeyPart | null; target: KeyPart } | null {
  if (key.includes('*')) return null;
  const first = readKeyPart(key);
  if (!first) return null;
  if (first.rest === '') return { parent: null, target: first };
  if (!first.rest.startsWith('/')) return null;
  const target = readKeyPart(first.rest.slice(1));
  return target && target.rest === '' ? { parent: first, target } : null;
}

/**
 * Apply the root manifest's `resolutions` to `workspace`'s direct dependency, as yarn berry does
 * before locking. Like yarn, the **first** matching key in manifest order wins (verified against
 * yarn 4.5 and 4.18 lockfiles): `react`, `react@<range>`, and `<workspace>/react` — a parent-scoped
 * key also overrides that workspace's own dependency.
 */
function applyResolutions(
  pkg: string,
  descriptor: string,
  resolutions: Record<string, unknown>,
  workspace: string | undefined,
): string {
  for (const [key, value] of Object.entries(resolutions)) {
    if (typeof value !== 'string') continue;
    const parsed = parseResolutionKey(key);
    if (!parsed || parsed.target.name !== pkg) continue;
    const { parent, target } = parsed;
    if (target.range !== undefined && berryDescriptor(target.range) !== descriptor) continue;
    if (parent && (parent.name !== workspace || !/^(?:workspace:|$)/.test(parent.range ?? ''))) continue;
    return berryDescriptor(value);
  }
  return descriptor;
}

/** The range a `catalog:` / `catalog:<name>` descriptor names in `.yarnrc.yml`, or null. */
function catalogRange(
  yarnrc: Record<string, unknown> | null | undefined,
  catalog: string,
  pkg: string,
): string | null {
  if (!yarnrc) return null;
  const named = isPlainObject(yarnrc.catalogs) ? yarnrc.catalogs[catalog] : undefined;
  const table = catalog === '' ? yarnrc.catalog : named;
  if (!isPlainObject(table) || !Object.hasOwn(table, pkg)) return null;
  const range = table[pkg];
  return typeof range === 'string' ? range : null;
}

/**
 * The package a berry resolution installs. A patch wraps another locator, URL-encoded:
 * `svelte@patch:preact@npm%3A10.19.0#…` installs preact, whatever name the dependency uses.
 */
function installedName(resolution: string): string | null {
  const name = leadingPackageName(resolution);
  if (!name) return null;
  const rest = resolution.slice(name.length + 1);
  if (!rest.startsWith('patch:')) return name;
  try {
    return installedName(decodeURIComponent(rest.slice('patch:'.length).split('#')[0]));
  } catch {
    return null;
  }
}

/** The version of `entry` when it is a real (non-linked) install of `pkg` itself, else null. */
function entryVersion(pkg: string, entry: YarnEntry | undefined): string | null {
  if (!entry || entry.linkType === 'soft') return null;
  const name = entry.resolution ? installedName(entry.resolution) : pkg;
  if (name !== pkg) return null;
  return valid(entry.version ?? '');
}

/**
 * The version of `pkg` when every lockfile entry keyed by `pkg` is a real install of it at one
 * version; null when there are none, several, or any that installs something else (an alias, a
 * link) — the unknown descriptor could be that one.
 */
function onlyVersion(pkg: string, entries: YarnEntry[]): string | null {
  const versions = new Set<string | null>();
  for (const entry of entries) {
    if (!entry.specs.some((spec) => leadingPackageName(spec) === pkg)) continue;
    if (workspacePath(entry.resolution) !== null) continue;
    versions.add(entryVersion(pkg, entry));
  }
  const [only] = versions;
  return versions.size === 1 && only !== undefined ? only : null;
}

function berryLockfile({ bySpec, entries }: ParsedEntries, context: LockfileContext): Lockfile {
  const workspaces = new Map<string, BerryWorkspace>();
  for (const entry of entries) {
    const path = workspacePath(entry.resolution);
    const name = entry.resolution ? leadingPackageName(entry.resolution) : null;
    if (path !== null && name) workspaces.set(path, { name, dependencies: entry.dependencies ?? new Map() });
  }
  const manifestResolutions = context.rootManifest?.resolutions;
  const resolutions = isPlainObject(manifestResolutions) ? manifestResolutions : {};

  const resolve = (pkg: string, declared: string, workspace: string | undefined): string | null => {
    let descriptor = applyResolutions(pkg, declared, resolutions, workspace);
    if (descriptor.startsWith('catalog:')) {
      const range = catalogRange(context.yarnrc, descriptor.slice('catalog:'.length), pkg);
      // Without `.yarnrc.yml` (a remote scan), only an unambiguous lockfile can answer.
      if (range === null) return onlyVersion(pkg, entries);
      descriptor = applyResolutions(pkg, berryDescriptor(range), resolutions, workspace);
    }
    return entryVersion(pkg, bySpec.get(`${pkg}@${descriptor}`));
  };

  return {
    file: 'yarn.lock',
    versionOf(pkg: string, chain: LockfileImporter[]) {
      for (const { path, range } of chain) {
        const workspace = workspaces.get(path || '.');
        // yarn 2/3 list a workspace's bare range (`^18.2.0`); yarn 4 writes `npm:^18.2.0`.
        const declared = workspace?.dependencies.get(pkg) ?? range;
        if (declared !== undefined) return resolve(pkg, berryDescriptor(declared), workspace?.name);
      }
      return null;
    },
  };
}

export function parseYarnLock(text: string, context: LockfileContext): Lockfile | null {
  const berry = /^"?__metadata"?:/m.test(text);
  if (!berry && !/^# yarn lockfile v1\b/m.test(text)) return null;
  const parsed = readEntries(text, berry);
  return berry ? berryLockfile(parsed, context) : v1Lockfile(parsed);
}
