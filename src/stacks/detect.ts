import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { coerce } from 'semver';
import { parse as parseYaml } from 'yaml';
import { loadCatalogSync } from '../catalog/index.js';
import type { BlueprintConfig, Stack } from '../types.js';
import {
  LOCKFILE_NAMES,
  npmLockfile,
  oversizeError,
  parseLockfile,
  type Lockfile,
  type LockfileImporter,
  type LockfileName,
} from './lockfile.js';
import { aliasesOtherPackage, isPlainObject } from './lockfile-shared.js';
import type { DetectedStack, DetectedStacks } from './match.js';
import {
  buildStackPackages,
  builtinStackPackages,
  packageForStack,
  withImpliedStacks,
  type StackPackages,
} from './packages.js';

/**
 * Project stack/version detection (Milestone M4).
 *
 * Precedence per stack, highest confidence first:
 *   1. declared in `bluetemberg.config.json` `stacks` (pinned, not `"auto"`) — `declared`
 *   2. `node_modules/<pkg>/package.json` `.version` — `exact` (PM-agnostic; what `ng update` reads)
 *   3. lockfile version — `exact`: `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock` (v1 or
 *      berry), read per workspace package (the pnpm importer, the yarn workspace) — see `lockfile.ts`
 *   4. coerced range from the project `package.json` dependencies — `coerced` (low confidence)
 *
 * Steps 2 and 3 follow Node's own resolution: a workspace package whose dependency was hoisted
 * resolves it from an ancestor `node_modules` (and the workspace-root lockfile), up to the repo
 * boundary — so detection reports the version the package actually runs, not a coerced guess.
 *
 * An unreadable lockfile (malformed, unrecognised, too large) never fails detection: it falls back
 * to step 4 and is reported once through `onWarning` for the command to log. Unknown/uninstalled
 * stacks are omitted, never guessed.
 */

/** Reports a lockfile that could not be used. Library code never prints; the command's `log` does. */
export type DetectWarningSink = (message: string) => void;

/**
 * Per-call state: each lockfile and manifest is read once per {@link detectStacks} call however
 * many stacks it resolves, so a broken lockfile is also warned about once.
 */
interface DetectSession {
  root: string;
  warn: DetectWarningSink;
  locks: Map<string, Lockfile | null>;
  manifests: Map<string, Record<string, string>>;
}

const AUTO = 'auto';

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Merge `dependencies` + `devDependencies` from an already-parsed manifest object. */
function depsFromManifest(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  return {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };
}

/**
 * `pkg`'s declared range: an own string entry only — `deps.constructor` is Object's, and a
 * hand-edited manifest can hold a non-string value.
 */
function depRange(deps: Record<string, string>, pkg: string): string | undefined {
  const range: unknown = Object.hasOwn(deps, pkg) ? deps[pkg] : undefined;
  return typeof range === 'string' ? range : undefined;
}

function manifestDeps(root: string): Record<string, string> {
  return depsFromManifest(readJson(join(root, 'package.json')));
}

function sessionDeps(session: DetectSession, dir: string): Record<string, string> {
  const cached = session.manifests.get(dir);
  if (cached) return cached;
  const deps = manifestDeps(dir);
  session.manifests.set(dir, deps);
  return deps;
}

/** Files/dirs that mark a repo or workspace root — where Node-style resolution stops climbing. */
const BOUNDARY_MARKERS = ['.git', 'package-lock.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'yarn.lock'];

function isBoundary(dir: string): boolean {
  if (BOUNDARY_MARKERS.some((m) => existsSync(join(dir, m)))) return true;
  return readJson(join(dir, 'package.json'))?.workspaces !== undefined;
}

/**
 * The directories Node would search for `node_modules`, nearest first: `root` and its ancestors up
 * to (and including) the nearest repo/workspace boundary. With no boundary above, only `root` is
 * searched — detection never escapes into an unrelated parent directory.
 */
function resolutionDirs(root: string): string[] {
  const start = resolve(root);
  const dirs: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (isBoundary(dir)) return dirs;
    if (dirname(dir) === dir) return [start];
  }
}

/** Human-readable source label: `node_modules` at the root, `../../node_modules` when hoisted. */
function sourceLabel(root: string, dir: string, file: string): string {
  const rel = relative(resolve(root), dir);
  return rel ? `${rel.split(sep).join('/')}/${file}` : file;
}

function resolveFromNodeModules(root: string, pkg: string): DetectedStack | null {
  for (const dir of resolutionDirs(root)) {
    const meta = readJson(join(dir, 'node_modules', ...pkg.split('/'), 'package.json'));
    if (typeof meta?.version === 'string') {
      return { version: meta.version, confidence: 'exact', source: sourceLabel(root, dir, 'node_modules') };
    }
  }
  return null;
}

/** A berry project's `.yarnrc.yml` (its `catalog:` tables), or null when absent or unreadable. */
function readYarnrc(dir: string): Record<string, unknown> | null {
  const path = join(dir, '.yarnrc.yml');
  if (!existsSync(path)) return null;
  try {
    const data: unknown = parseYaml(readFileSync(path, 'utf8'), { maxAliasCount: 0 });
    return isPlainObject(data) ? data : null;
  } catch {
    return null;
  }
}

/** A lockfile read from disk: the reader, or why it can't be used (one line). */
interface LockfileRead {
  lock: Lockfile | null;
  error?: string;
}

/**
 * Parsed lockfiles kept across {@link detectStacks} calls. A recursive sync or `why` over a
 * monorepo detects once per configured package, and every one of those reads the same root
 * lockfile — parse it once. An entry is reused only while the lockfile and the files that shape
 * its answers (`package.json` for `resolutions`, `.yarnrc.yml` for catalogs) are unchanged.
 */
const LOCKFILE_CACHE_SIZE = 4;
const lockfileCache = new Map<string, { stamp: string; read: LockfileRead }>();

function fileStamp(path: string): string {
  try {
    const { size, mtimeMs } = statSync(path);
    return `${size}:${mtimeMs}`;
  } catch {
    return '-';
  }
}

/** Read and parse one lockfile from disk. Never throws: a failure comes back as `error`. */
function readLockfile(dir: string, file: LockfileName): LockfileRead {
  const path = join(dir, file);
  try {
    const tooLarge = oversizeError(statSync(path).size);
    if (tooLarge) return { lock: null, error: tooLarge };
    const context = {
      rootManifest: readJson(join(dir, 'package.json')),
      yarnrc: file === 'yarn.lock' ? readYarnrc(dir) : null,
    };
    const parsed = parseLockfile(file, readFileSync(path, 'utf8'), context);
    return { lock: parsed.lock ?? null, error: parsed.error };
  } catch (err) {
    return { lock: null, error: `could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
}

function cachedLockfile(dir: string, file: LockfileName): LockfileRead {
  const path = join(dir, file);
  const stamp = [path, join(dir, 'package.json'), join(dir, '.yarnrc.yml')].map(fileStamp).join('|');
  const hit = lockfileCache.get(path);
  if (hit?.stamp === stamp) return hit.read;
  const read = readLockfile(dir, file);
  lockfileCache.delete(path);
  lockfileCache.set(path, { stamp, read });
  if (lockfileCache.size > LOCKFILE_CACHE_SIZE) lockfileCache.delete(lockfileCache.keys().next().value ?? '');
  return read;
}

/** The lockfile for this call, warning (once per call) when it can't be used. */
function sessionLockfile(session: DetectSession, dir: string, file: LockfileName): Lockfile | null {
  const path = join(dir, file);
  if (session.locks.has(path)) return session.locks.get(path) ?? null;
  const { lock, error } = cachedLockfile(dir, file);
  if (error !== undefined) {
    const label = sourceLabel(session.root, dir, file);
    session.warn(`${label} ${error} — using package.json ranges for stack versions`);
  }
  session.locks.set(path, lock);
  return lock;
}

/**
 * Resolve from the nearest lockfile at or above `root` (in a workspace, the root lockfile holds
 * every package's install). The chain handed to the reader runs from the package itself up to the
 * lockfile's directory, nearest first, so the package's own pnpm importer / yarn workspace / npm
 * nested entry wins over the root's. Several lockfiles in one directory are tried in
 * {@link LOCKFILE_NAMES} order.
 */
function resolveFromLockfile(session: DetectSession, pkg: string): DetectedStack | null {
  const dirs = resolutionDirs(session.root);
  for (let i = 0; i < dirs.length; i++) {
    const lockDir = dirs[i];
    const files = LOCKFILE_NAMES.filter((file) => existsSync(join(lockDir, file)));
    if (files.length === 0) continue;
    const chain: LockfileImporter[] = dirs.slice(0, i + 1).map((dir) => ({
      path: relative(lockDir, dir).split(sep).join('/'),
      range: depRange(sessionDeps(session, dir), pkg),
    }));
    for (const file of files) {
      const version = sessionLockfile(session, lockDir, file)?.versionOf(pkg, chain);
      if (version) return { version, confidence: 'exact', source: sourceLabel(session.root, lockDir, file) };
    }
    return null;
  }
  return null;
}

function isLockfile(value: Lockfile | Record<string, unknown>): value is Lockfile {
  return typeof value.versionOf === 'function';
}

function toLockfile(value: Lockfile | Record<string, unknown> | null | undefined): Lockfile | null {
  if (!value) return null;
  return isLockfile(value) ? value : npmLockfile(value);
}

/**
 * Coerce `pkg`'s manifest range to a concrete (low-confidence) version, or null. An alias to a
 * different package (`"svelte": "npm:preact@10.19.0"`) is that package's range, never `pkg`'s.
 */
function coercedFromRange(pkg: string, range: string | undefined): DetectedStack | null {
  if (!range || aliasesOtherPackage(pkg, range)) return null;
  const c = coerce(range, { includePrerelease: true });
  return c ? { version: c.version, confidence: 'coerced', source: 'package.json' } : null;
}

/**
 * The candidate stack set: every stack declared in config, every mapped stack whose package
 * appears in the dependency map, and every stack those imply (see {@link withImpliedStacks}).
 * Shared by the on-disk and manifest entry-points so both surface stacks the user did not declare.
 * Maps each candidate to the stack that implied it (`null` when direct).
 */
function candidateStacks(
  declared: Record<string, string>,
  deps: Record<string, string>,
  packages: StackPackages,
): Map<Stack, Stack | null> {
  const direct = new Set<Stack>(Object.keys(declared));
  for (const [stack, { npm }] of packages) {
    // Own keys only: `deps.constructor` is Object's, and a catalog may name a stack `constructor`.
    if (npm !== undefined && Object.hasOwn(deps, npm)) direct.add(stack);
  }
  return withImpliedStacks(direct, packages);
}

/** The config-declared version of `stack`, never an inherited `Object.prototype` member. */
function declaredVersion(declared: Record<string, string>, stack: Stack): string | undefined {
  return Object.hasOwn(declared, stack) ? declared[stack] : undefined;
}

/** Label an implied detection with what brought it in: `node_modules, implied by nextjs`. */
function labelImplied(resolved: DetectedStack, impliedBy: Stack | null): DetectedStack {
  return impliedBy ? { ...resolved, source: `${resolved.source}, implied by ${impliedBy}` } : resolved;
}

/** Resolve one stack from disk: declared → node_modules → lockfile → coerced manifest range. */
function resolveStack(
  session: DetectSession,
  stack: Stack,
  declared: string | undefined,
  packages: StackPackages,
): DetectedStack | null {
  if (declared !== undefined && declared !== AUTO) {
    return { version: declared, confidence: 'declared', source: 'config' };
  }
  const pkg = packageForStack(stack, packages);

  return (
    resolveFromNodeModules(session.root, pkg) ??
    resolveFromLockfile(session, pkg) ??
    coercedFromRange(pkg, depRange(sessionDeps(session, session.root), pkg))
  );
}

/** Resolve one stack from in-memory data (remote): declared → lockfile → coerced manifest range. */
function resolveStackFromData(
  stack: Stack,
  declared: string | undefined,
  deps: Record<string, string>,
  lock: Lockfile | null,
  packages: StackPackages,
): DetectedStack | null {
  if (declared !== undefined && declared !== AUTO) {
    return { version: declared, confidence: 'declared', source: 'config' };
  }
  const pkg = packageForStack(stack, packages);

  const range = depRange(deps, pkg);
  const fromLock = lock?.versionOf(pkg, [{ path: '', range }]);
  if (fromLock) return { version: fromLock, confidence: 'exact', source: lock?.file ?? 'lockfile' };

  return coercedFromRange(pkg, range);
}

/**
 * Detect the project's stacks and resolved versions. Considers (a) every stack declared in
 * config, (b) every mapped stack whose package appears in the project's dependencies, and (c) the
 * stacks those imply, so the wizard/coverage can surface stacks the user did not declare.
 *
 * `packages` is the stack → package map; omitted, it is read from the project's catalog (cache,
 * else the committed snapshot — never the network), so every command detects with the same map.
 * `onWarning` receives one line per lockfile that could not be used; sync, `why` and the reports
 * pass their own sink so they warn with the same words.
 */
export function detectStacks(
  root: string,
  config?: Pick<BlueprintConfig, 'stacks'>,
  packages: StackPackages = buildStackPackages(loadCatalogSync(root)).packages,
  onWarning: DetectWarningSink = () => {},
): DetectedStacks {
  const declared = config?.stacks ?? {};
  const session: DetectSession = { root, warn: onWarning, locks: new Map(), manifests: new Map() };
  const deps = sessionDeps(session, root);

  const detected: DetectedStacks = new Map();
  for (const [stack, impliedBy] of candidateStacks(declared, deps, packages)) {
    const resolved = resolveStack(session, stack, declaredVersion(declared, stack), packages);
    if (resolved) detected.set(stack, labelImplied(resolved, impliedBy));
  }
  return detected;
}

/**
 * Detect stacks from an already-fetched manifest + lockfile, without touching disk (Milestone M6
 * remote scan). Mirrors {@link detectStacks} precedence minus the `node_modules` layer, which is
 * unavailable when reading a repo over the GitHub API: declared → lockfile-exact → coerced
 * manifest range. `lockfile` is a parsed {@link Lockfile} (any format, see `parseLockfile`), or a
 * plain `package-lock.json` object. Shares the lockfile readers and candidate-set logic with the
 * on-disk path. With no project to read a catalog from, `packages` defaults to the built-in map.
 */
export function detectStacksFromManifests(
  manifestJson: Record<string, unknown>,
  lockfile?: Lockfile | Record<string, unknown> | null,
  config?: Pick<BlueprintConfig, 'stacks'>,
  packages: StackPackages = builtinStackPackages(),
): DetectedStacks {
  const declared = config?.stacks ?? {};
  const deps = depsFromManifest(manifestJson);
  const lock = toLockfile(lockfile);

  const detected: DetectedStacks = new Map();
  for (const [stack, impliedBy] of candidateStacks(declared, deps, packages)) {
    const resolved = resolveStackFromData(stack, declaredVersion(declared, stack), deps, lock, packages);
    if (resolved) detected.set(stack, labelImplied(resolved, impliedBy));
  }
  return detected;
}
