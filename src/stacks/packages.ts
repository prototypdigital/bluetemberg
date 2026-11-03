import type { Catalog } from '../catalog/index.js';
import type { Stack } from '../types.js';

/**
 * The stack-name → package-name map that detection reads (#290).
 *
 * Two layers, merged per stack:
 *   1. the built-in table below — the engine's fallback, and the whole map for any catalog that
 *      does not carry one (every snapshot before #290)
 *   2. the catalog's `stackPackages` block, owned by the packs repo — so a pack that targets a new
 *      stack can make it detectable without an engine release
 *
 * A catalog entry wins over the built-in entry for the same stack, field by field: its `npm`
 * package replaces the built-in one when present, and its `implies` list is the only source of
 * implied stacks (the built-in table implies nothing, which keeps today's behaviour). The catalog
 * can add or remap a stack; it cannot delete a built-in one.
 *
 * Parsing is deliberately lenient: this is data from the network or a project cache, and a bad
 * entry must never break detection. Every dropped entry, and an ignored block, is reported as an
 * issue string for the caller to surface — never printed here.
 */

/** Built-in stack → npm package table. Open vocab: unmapped names map to themselves. */
export const BUILTIN_STACK_PACKAGES: Readonly<Record<string, string>> = {
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

/** The `stackPackages.schema` this engine understands. A newer one is ignored as a whole. */
export const STACK_PACKAGES_SCHEMA = 1;

/** One stack's resolved mapping. */
export interface StackPackageEntry {
  /**
   * The npm package whose version is the stack's version. Unset for a catalog stack mapped only
   * to another ecosystem (or only to `implies`): it is then never auto-detected from npm, exactly
   * like an unmapped stack, though a declared or implied one still resolves via its own name.
   */
  npm: string | undefined;
  /** Stacks this one brings along (Next.js → React), detected only when actually resolvable. */
  implies: Stack[];
}

export type StackPackages = ReadonlyMap<Stack, StackPackageEntry>;

export interface StackPackagesResult {
  packages: StackPackages;
  /** Catalog data that was ignored, one line each. Empty for a well-formed or absent block. */
  issues: string[];
}

/** npm's rule for new package names: lowercase, URL-safe, optional scope, no leading `.`/`_`. */
const NPM_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_NAME_MAX = 214;

/** Stack names are open vocabulary, but must be one token: they are keys, CLI args and log text. */
const STACK_NAME = /^[a-z0-9][a-z0-9._-]*$/;

function isNpmName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= NPM_NAME_MAX && NPM_NAME.test(value);
}

function isStackName(value: unknown): value is string {
  return typeof value === 'string' && STACK_NAME.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function builtinEntries(): Map<Stack, StackPackageEntry> {
  return new Map(Object.entries(BUILTIN_STACK_PACKAGES).map(([stack, npm]) => [stack, { npm, implies: [] }]));
}

/** The built-in map alone — what an old snapshot, or no catalog at all, resolves to. */
export function builtinStackPackages(): StackPackages {
  return builtinEntries();
}

/** The npm package for `stack`: its mapped package, else the stack name itself. */
export function packageForStack(stack: Stack, packages: StackPackages = builtinStackPackages()): string {
  return packages.get(stack)?.npm ?? stack;
}

/** Parse one entry's `implies`, or a reason it is unusable. Self-references are dropped. */
function parseImplies(stack: Stack, raw: unknown, issues: string[]): Stack[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every(isStackName)) return '"implies" must be an array of stack names';
  if (raw.includes(stack)) issues.push(`stackPackages.stacks.${stack}: implies itself — ignored`);
  return [...new Set(raw.filter((s) => s !== stack))];
}

/** Parse one entry into a partial override, or a reason it is unusable. */
function parseEntry(
  stack: Stack,
  raw: unknown,
  issues: string[],
): { npm?: string; implies: Stack[] } | string {
  if (!isPlainObject(raw)) return 'entry must be an object';
  const packages = raw.packages;
  if (packages !== undefined && !isPlainObject(packages)) return '"packages" must be an object';
  // Ecosystems other than npm are reserved for future readers and ignored here.
  const npm = packages?.npm;
  if (npm !== undefined && !isNpmName(npm)) return `"packages.npm" is not a valid npm package name`;
  const implies = parseImplies(stack, raw.implies, issues);
  if (typeof implies === 'string') return implies;
  return { npm, implies };
}

/** Why the block as a whole is unusable, or null when its entries can be read. */
function blockIssue(block: Record<string, unknown>): string | null {
  const { schema } = block;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return 'stackPackages ignored: "schema" must be a positive integer';
  }
  if (schema > STACK_PACKAGES_SCHEMA) {
    return `stackPackages ignored: schema ${schema} is newer than this engine reads (${STACK_PACKAGES_SCHEMA}) — upgrade bluetemberg to use the catalog's stack map`;
  }
  if (!isPlainObject(block.stacks)) return 'stackPackages ignored: "stacks" must be an object';
  return null;
}

/**
 * Merge the catalog's `stackPackages` block over the built-in table. An absent block yields the
 * built-in map with no issues; an unreadable one yields the built-in map plus one issue.
 */
export function buildStackPackages(catalog: Pick<Catalog, 'stackPackages'>): StackPackagesResult {
  const packages = builtinEntries();
  const issues: string[] = [];
  const block = catalog.stackPackages;
  if (block === undefined) return { packages, issues };
  if (!isPlainObject(block)) return { packages, issues: ['stackPackages ignored: must be an object'] };

  const unusable = blockIssue(block);
  if (unusable) return { packages, issues: [unusable] };

  // Two stacks on one package are one stack under two names: both are detected, and scan-org counts
  // every repo twice. A built-in cannot be deleted, so this includes a catalog entry that reuses a
  // built-in's package under a new name — it adds an alias, it does not rename. Warn; the packs repo
  // fixes it by using the existing name.
  const claimedBy = new Map<string, string>(
    Object.entries(BUILTIN_STACK_PACKAGES).map(([stack, npm]) => [npm, `${stack} (built-in)`]),
  );
  for (const [stack, raw] of Object.entries(block.stacks as Record<string, unknown>)) {
    if (!isStackName(stack)) {
      issues.push(`stackPackages.stacks: "${stack}" is not a valid stack name — ignored`);
      continue;
    }
    const entry = parseEntry(stack, raw, issues);
    const builtin = packages.get(stack);
    if (typeof entry === 'string') {
      const fallback = builtin ? 'using the built-in mapping' : 'the stack stays unmapped';
      issues.push(`stackPackages.stacks.${stack}: ${entry} — ignored, ${fallback}`);
      continue;
    }
    const npm = entry.npm ?? builtin?.npm;
    const other = npm === undefined ? undefined : claimedBy.get(npm);
    if (npm !== undefined && other !== undefined && other !== `${stack} (built-in)`) {
      issues.push(
        `stackPackages.stacks.${stack}: package "${npm}" is also mapped by ${other} — both names are detected`,
      );
    } else if (npm !== undefined && other === undefined) {
      claimedBy.set(npm, stack);
    }
    packages.set(stack, { npm, implies: entry.implies });
  }
  return { packages, issues };
}

/**
 * Close `direct` over `implies`: every directly present stack, plus every stack those imply,
 * transitively. Maps each stack to the stack that first brought it in (`null` when direct), so a
 * caller can label an implied detection. Cycles terminate — a stack is visited once.
 */
export function withImpliedStacks(
  direct: Iterable<Stack>,
  packages: StackPackages,
): Map<Stack, Stack | null> {
  const out = new Map<Stack, Stack | null>();
  const queue: Stack[] = [];
  for (const stack of direct) {
    if (out.has(stack)) continue;
    out.set(stack, null);
    queue.push(stack);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const implied of packages.get(queue[i])?.implies ?? []) {
      if (out.has(implied)) continue;
      out.set(implied, queue[i]);
      queue.push(implied);
    }
  }
  return out;
}
