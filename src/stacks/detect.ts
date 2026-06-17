import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coerce } from 'semver';
import type { BlueprintConfig, Stack } from '../types.js';
import type { DetectedStack, DetectedStacks } from './match.js';

/**
 * Project stack/version detection (Milestone M4).
 *
 * Precedence per stack, highest confidence first:
 *   1. declared in `bluetemberg.config.json` `stacks` (pinned, not `"auto"`) — `declared`
 *   2. `node_modules/<pkg>/package.json` `.version` — `exact` (PM-agnostic; what `ng update` reads)
 *   3. `package-lock.json` resolved version — `exact`
 *   4. coerced range from the project `package.json` dependencies — `coerced` (low confidence)
 *
 * Robust without a YAML dependency: step 2 covers pnpm/yarn/npm equally once installed, so a
 * lockfile-format parser is not required for correctness here (a pnpm/yarn-lock fast path is a
 * follow-up refinement). Unknown/uninstalled stacks are omitted, never guessed.
 */

const AUTO = 'auto';

/** Default stack-name → npm-package-name mapping. Open vocab: unmapped names map to themselves. */
export const STACK_PACKAGE_MAP: Readonly<Record<string, string>> = {
  nextjs: 'next',
  react: 'react',
  payload: 'payload',
  angular: '@angular/core',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  solid: 'solid-js',
  tailwind: 'tailwindcss',
  drizzle: 'drizzle-orm',
  trpc: '@trpc/server',
};

export function packageForStack(stack: Stack): string {
  return STACK_PACKAGE_MAP[stack] ?? stack;
}

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

function manifestDeps(root: string): Record<string, string> {
  return depsFromManifest(readJson(join(root, 'package.json')));
}

function resolveFromNodeModules(root: string, pkg: string): string | null {
  const meta = readJson(join(root, 'node_modules', ...pkg.split('/'), 'package.json'));
  return typeof meta?.version === 'string' ? meta.version : null;
}

/**
 * Resolve a package's version from an already-parsed lockfile object. Handles both shapes:
 * lockfileVersion 2/3 (`packages["node_modules/<pkg>"]`) and 1 (`dependencies[<pkg>]`). Shared by
 * the on-disk path and the remote manifest path so the version-shape logic lives in one place.
 */
function lockfileVersionFor(lock: Record<string, unknown> | null, pkg: string): string | null {
  if (!lock) return null;
  const packages = lock.packages as Record<string, { version?: unknown }> | undefined;
  const v3 = packages?.[`node_modules/${pkg}`]?.version;
  if (typeof v3 === 'string') return v3;
  const deps = lock.dependencies as Record<string, { version?: unknown }> | undefined;
  const v1 = deps?.[pkg]?.version;
  return typeof v1 === 'string' ? v1 : null;
}

function resolveFromPackageLock(root: string, pkg: string): string | null {
  return lockfileVersionFor(readJson(join(root, 'package-lock.json')), pkg);
}

/** Coerce a manifest dependency range to a concrete (low-confidence) version, or null. */
function coercedFromRange(range: string | undefined): DetectedStack | null {
  if (!range) return null;
  const c = coerce(range, { includePrerelease: true });
  return c ? { version: c.version, confidence: 'coerced', source: 'package.json' } : null;
}

/**
 * The candidate stack set: every stack declared in config plus every known stack whose package
 * appears in the dependency map. Shared by the on-disk and manifest entry-points so both surface
 * stacks the user did not declare.
 */
function candidateStacks(declared: Record<string, string>, deps: Record<string, string>): Set<Stack> {
  const candidates = new Set<Stack>(Object.keys(declared));
  for (const [stack, pkg] of Object.entries(STACK_PACKAGE_MAP)) {
    if (deps[pkg] !== undefined) candidates.add(stack);
  }
  return candidates;
}

/** Resolve one stack from disk: declared → node_modules → lockfile → coerced manifest range. */
function resolveStack(root: string, stack: Stack, declared: string | undefined): DetectedStack | null {
  if (declared !== undefined && declared !== AUTO) {
    return { version: declared, confidence: 'declared', source: 'config' };
  }
  const pkg = packageForStack(stack);

  const fromNodeModules = resolveFromNodeModules(root, pkg);
  if (fromNodeModules) return { version: fromNodeModules, confidence: 'exact', source: 'node_modules' };

  const fromLock = resolveFromPackageLock(root, pkg);
  if (fromLock) return { version: fromLock, confidence: 'exact', source: 'package-lock.json' };

  return coercedFromRange(manifestDeps(root)[pkg]);
}

/** Resolve one stack from in-memory data (remote): declared → lockfile → coerced manifest range. */
function resolveStackFromData(
  stack: Stack,
  declared: string | undefined,
  deps: Record<string, string>,
  lock: Record<string, unknown> | null,
): DetectedStack | null {
  if (declared !== undefined && declared !== AUTO) {
    return { version: declared, confidence: 'declared', source: 'config' };
  }
  const pkg = packageForStack(stack);

  const fromLock = lockfileVersionFor(lock, pkg);
  if (fromLock) return { version: fromLock, confidence: 'exact', source: 'package-lock.json' };

  return coercedFromRange(deps[pkg]);
}

/**
 * Detect the project's stacks and resolved versions. Considers (a) every stack declared in
 * config and (b) every known stack whose package appears in the project's dependencies, so the
 * wizard/coverage can surface stacks the user did not declare.
 */
export function detectStacks(root: string, config?: Pick<BlueprintConfig, 'stacks'>): DetectedStacks {
  const declared = config?.stacks ?? {};
  const deps = manifestDeps(root);

  const detected: DetectedStacks = new Map();
  for (const stack of candidateStacks(declared, deps)) {
    const resolved = resolveStack(root, stack, declared[stack]);
    if (resolved) detected.set(stack, resolved);
  }
  return detected;
}

/**
 * Detect stacks from already-fetched manifest + lockfile JSON, without touching disk (Milestone
 * M6 remote scan). Mirrors {@link detectStacks} precedence minus the `node_modules` layer, which
 * is unavailable when reading a repo over the GitHub API: declared → lockfile-exact → coerced
 * manifest range. Shares the lockfile-shape and candidate-set logic with the on-disk path.
 */
export function detectStacksFromManifests(
  manifestJson: Record<string, unknown>,
  lockfileJson?: Record<string, unknown> | null,
  config?: Pick<BlueprintConfig, 'stacks'>,
): DetectedStacks {
  const declared = config?.stacks ?? {};
  const deps = depsFromManifest(manifestJson);
  const lock = lockfileJson ?? null;

  const detected: DetectedStacks = new Map();
  for (const stack of candidateStacks(declared, deps)) {
    const resolved = resolveStackFromData(stack, declared[stack], deps, lock);
    if (resolved) detected.set(stack, resolved);
  }
  return detected;
}
