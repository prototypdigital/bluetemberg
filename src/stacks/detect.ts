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

function manifestDeps(root: string): Record<string, string> {
  const pkg = readJson(join(root, 'package.json'));
  if (!pkg) return {};
  return {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };
}

function resolveFromNodeModules(root: string, pkg: string): string | null {
  const meta = readJson(join(root, 'node_modules', ...pkg.split('/'), 'package.json'));
  return typeof meta?.version === 'string' ? meta.version : null;
}

function resolveFromPackageLock(root: string, pkg: string): string | null {
  const lock = readJson(join(root, 'package-lock.json'));
  if (!lock) return null;
  // lockfileVersion 2/3: keyed under `packages["node_modules/<pkg>"]`.
  const packages = lock.packages as Record<string, { version?: unknown }> | undefined;
  const v3 = packages?.[`node_modules/${pkg}`]?.version;
  if (typeof v3 === 'string') return v3;
  // lockfileVersion 1: `dependencies[<pkg>].version`.
  const deps = lock.dependencies as Record<string, { version?: unknown }> | undefined;
  const v1 = deps?.[pkg]?.version;
  return typeof v1 === 'string' ? v1 : null;
}

/** Resolve one stack to a {version, confidence, source}, or null when not present in the project. */
function resolveStack(root: string, stack: Stack, declared: string | undefined): DetectedStack | null {
  if (declared !== undefined && declared !== AUTO) {
    return { version: declared, confidence: 'declared', source: 'config' };
  }
  const pkg = packageForStack(stack);

  const fromNodeModules = resolveFromNodeModules(root, pkg);
  if (fromNodeModules) return { version: fromNodeModules, confidence: 'exact', source: 'node_modules' };

  const fromLock = resolveFromPackageLock(root, pkg);
  if (fromLock) return { version: fromLock, confidence: 'exact', source: 'package-lock.json' };

  const range = manifestDeps(root)[pkg];
  if (range) {
    const c = coerce(range, { includePrerelease: true });
    if (c) return { version: c.version, confidence: 'coerced', source: 'package.json' };
  }
  return null;
}

/**
 * Detect the project's stacks and resolved versions. Considers (a) every stack declared in
 * config and (b) every known stack whose package appears in the project's dependencies, so the
 * wizard/coverage can surface stacks the user did not declare.
 */
export function detectStacks(root: string, config?: Pick<BlueprintConfig, 'stacks'>): DetectedStacks {
  const declared = config?.stacks ?? {};
  const deps = manifestDeps(root);

  const candidates = new Set<Stack>(Object.keys(declared));
  for (const [stack, pkg] of Object.entries(STACK_PACKAGE_MAP)) {
    if (deps[pkg] !== undefined) candidates.add(stack);
  }

  const detected: DetectedStacks = new Map();
  for (const stack of candidates) {
    const resolved = resolveStack(root, stack, declared[stack]);
    if (resolved) detected.set(stack, resolved);
  }
  return detected;
}
