import { MARKETPLACE_PLATFORM, type Platform } from '../types.js';
import type { Catalog } from './index.js';
import { buildPackItemMap, type PackItemMap } from './ownership.js';

/**
 * Platform routing for pack content (#281). A pack, or a single file in it, can name the platforms
 * its content works on — `platforms: [claude]` for content that needs Claude Code hooks or headless
 * `claude -p`. Sync then skips that content's output for every other platform, and `init` does not
 * preselect a pack none of whose platforms the project targets.
 *
 * The vocabulary is the guardrail `platforms` vocabulary: the `Platform` ids, with `windsurf`
 * accepted as an alias for `devin`. Resolution mirrors `stacks`:
 *   1. the file's own `platforms:` frontmatter — wins when present
 *   2. the catalog pack-level `platforms` of the pack that owns the file
 *   3. nothing → every platform
 *
 * An empty list means "every platform", like an empty catalog `stacks`; the catalog generator emits
 * `[]` for packs that declare nothing. (A guardrail's own empty `platforms: []` keeps its older
 * meaning — compiled for no host — since that field predates this one.)
 *
 * `claude-marketplace` publishes Claude Code plugins, so content listing `claude` is published there
 * too; content can also name `claude-marketplace` alone to ship only in the plugins.
 */

/** Every platform id, the `windsurf` alias included. Ids outside this list never match. */
export const KNOWN_PLATFORMS: readonly Platform[] = [
  'cursor',
  'claude',
  'copilot',
  'gemini',
  'antigravity',
  'devin',
  'windsurf',
  'codex',
  MARKETPLACE_PLATFORM,
];

export type PlatformMap = PackItemMap<string[]>;

/** Where a file's effective platform list came from (see the module comment). */
export type PlatformSource = 'frontmatter' | 'catalog' | 'none';

export interface PlatformGate {
  /** The effective list as written; `null` = every platform. */
  platforms: string[] | null;
  source: PlatformSource;
  /** Entries that name no known platform: they match nothing, so sync warns. */
  unknown: string[];
  /** Set when the `platforms:` frontmatter is not a list of strings; it is then ignored. */
  invalid: string | null;
}

/** Pack-scoped map of catalog `platforms`; packs with none (or an empty list) contribute nothing. */
export function buildPlatformMap(catalog: Catalog): PlatformMap {
  return buildPackItemMap(catalog, (pack) => {
    const platforms = pack.platforms ?? [];
    return platforms.length > 0 ? platforms : undefined;
  });
}

/** True when a `platforms:` value is a list of strings — the guardrail validation. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The file's own `platforms:` list, or `undefined` when the key is absent, empty-valued, or
 * malformed. A malformed value falls back to catalog routing rather than widening the file to every
 * platform.
 */
function readFrontmatterPlatforms(data: Record<string, unknown>): string[] | undefined {
  return isStringList(data.platforms) ? data.platforms : undefined;
}

function frontmatterIssue(data: Record<string, unknown>): string | null {
  const value = data.platforms;
  if (value === undefined || value === null || isStringList(value)) return null;
  return '`platforms:` must be a list of platform ids; ignored';
}

function sourceOf(own: string[] | undefined, fromCatalog: string[] | undefined): PlatformSource {
  if (own !== undefined) return 'frontmatter';
  return fromCatalog !== undefined ? 'catalog' : 'none';
}

/**
 * Resolve a file's platform gate. `id` and `kindDir` locate the file the way the stack gate does
 * (`kindDir` decides which pack, if any, owns it).
 */
export function resolvePlatformGate(
  id: string,
  kindDir: string,
  frontmatter: Record<string, unknown>,
  platformMap: PlatformMap,
): PlatformGate {
  const own = readFrontmatterPlatforms(frontmatter);
  const fromCatalog = own === undefined ? platformMap.get(kindDir, id) : undefined;
  const list = own ?? fromCatalog;
  const platforms = list && list.length > 0 ? list : null;
  return {
    platforms,
    source: sourceOf(own, fromCatalog),
    unknown: unknownPlatforms(platforms),
    invalid: frontmatterIssue(frontmatter),
  };
}

/** Entries of `list` that are not platform ids. */
export function unknownPlatforms(list: readonly string[] | null | undefined): string[] {
  return (list ?? []).filter((p) => !(KNOWN_PLATFORMS as readonly string[]).includes(p));
}

/**
 * Whether content restricted to `list` is written for `target`. No list (or an empty one) allows
 * every platform; `windsurf` counts as `devin` on both sides; `claude-marketplace` also accepts
 * content that lists `claude`.
 */
export function allowsPlatform(list: readonly string[] | null | undefined, target: Platform): boolean {
  if (!list || list.length === 0) return true;
  const canonical = new Set(list.map(canonicalPlatform));
  const want = canonicalPlatform(target);
  if (canonical.has(want)) return true;
  return want === MARKETPLACE_PLATFORM && canonical.has('claude');
}

/** Whether content restricted to `list` is written for at least one of `targets`. */
export function allowsAnyPlatform(
  list: readonly string[] | null | undefined,
  targets: readonly Platform[],
): boolean {
  return targets.some((target) => allowsPlatform(list, target));
}

function canonicalPlatform(id: string): string {
  return id === 'windsurf' ? 'devin' : id;
}
