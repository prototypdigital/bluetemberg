import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import matter from 'gray-matter';
import { coerce, valid } from 'semver';
import { loadCatalogSync } from '../catalog/index.js';
import { readSourcePackName } from '../catalog/ownership.js';
import { createBundleOutputResolver } from '../sync/marketplace.js';
import type { BlueprintConfig, Platform } from '../types.js';
import { discoverConfigDirs, loadConfig } from '../sync/index.js';
import { dropLegacyGeminiRulesTarget } from '../sync/gemini.js';
import { guardrailValidationIssue } from '../sync/guardrails.js';
import { AGENTS_MD_RULE_PLATFORMS } from '../sync/codex.js';
import { GUARDRAIL_PLATFORMS, skippedPlatforms } from '../sync/platform-skips.js';
import {
  activeSources,
  CONTENT_KINDS,
  mergeContentKind,
  resolveSourceViews,
  resolveSyncSources,
  type ContentKind,
  type SourceOrigin,
  type SyncSource,
} from '../sync/sources.js';
import {
  configuredPlatforms,
  resolveAgentTargets,
  resolveRuleTargets,
  resolveSkillOutputs,
  skillDirsFor,
} from '../sync/targets.js';
import {
  allowsAnyPlatform,
  allowsPlatform,
  buildPlatformMap,
  resolvePlatformGate,
  type PlatformGate,
  type PlatformMap,
  type PlatformSource,
} from '../catalog/platforms.js';
import { detectStacks } from './detect.js';
import { buildStackPackages } from './packages.js';
import { evaluateStackGate, type StackGate } from './gate.js';
import {
  versionSatisfies,
  type DetectedStack,
  type DetectedStacks,
  type DetectionConfidence,
} from './match.js';
import { buildStackMap, type ConstraintSource, type StackMap } from './resolve.js';

/**
 * `bluetemberg why` (#293): explain why a rule, agent, skill or guardrail was included in or
 * excluded from this project, and diff the resolved set under a hypothetical stack upgrade.
 *
 * Everything here goes through sync's own pieces — `resolveSyncSources` for the source dirs,
 * `mergeContentKind` for which copy wins, `evaluateStackGate` for the version gate and
 * `guardrailValidationIssue` for guardrail rejection — so `why` cannot disagree with sync. Pure:
 * returns data; the CLI formats it with {@link formatWhyReport} / {@link formatWhyDiff}.
 */

/** How the `<file>` argument was resolved. */
export type WhyMatchForm = 'source' | 'output' | 'id';

export interface WhyDetection {
  version: string;
  confidence: DetectionConfidence;
  source: string;
}

/** One `stack: range` entry of the effective constraint, checked against detection. */
export interface WhyStackCheck {
  stack: string;
  range: string;
  /** What detection found for this stack; `null` when it is not present in the project. */
  detected: WhyDetection | null;
  satisfied: boolean;
  /** The match relies on a coerced/unknown detection — pin a version for precision. */
  lowConfidence: boolean;
}

export interface WhyItem {
  kind: ContentKind;
  id: string;
  included: boolean;
  /** One-line verdict: why it is in, or why it is out. */
  reason: string;
  /** The copy sync uses (highest-priority source that ships this id). */
  source: { origin: SourceOrigin; label: string; path: string };
  /** Lower-priority copies of the same id that sync ignores. */
  shadowed: Array<{ label: string; path: string }>;
  constraint: {
    /** `frontmatter` = the file's own `stacks:`; `catalog` = its pack's tag; `none` = agnostic. */
    source: ConstraintSource;
    /** npm package owning the source dir (decides catalog gating); `null` for project content. */
    pack: string | null;
    stacks: WhyStackCheck[];
  };
  /** Malformed or unsatisfiable `stacks:` entries sync warns about. */
  invalidRanges: string[];
  /** Platform routing (#281): the platforms the item is limited to, and the synced ones it skips. */
  platforms: {
    /** `frontmatter` = the file's own `platforms:`; `catalog` = its pack's; `none` = every platform. */
    source: PlatformSource;
    /** The effective list as written; `null` = every platform. */
    list: string[] | null;
    /** This project's platforms that get no output for the item. */
    skipped: Platform[];
    /** Entries of `list` that name no platform (sync warns; they match nothing). */
    unknown: string[];
    /** Set when the `platforms:` frontmatter is malformed and ignored (sync warns). */
    invalid: string | null;
  };
  /** Why sync rejects this guardrail before gating (invalid frontmatter/regex), else `null`. */
  invalid: string | null;
  /** Generated paths (relative to the root) sync writes for it; empty when excluded. */
  outputs: string[];
  /**
   * Set when scoped `extends` entries give platforms different copies of this id (or none): which
   * copy each group of platforms gets, and its verdict. `null` when every platform sees the same.
   */
  byPlatform: WhyPlatformCopy[] | null;
}

/** The copy a group of platforms syncs for an id, under scoped `extends` entries. */
export interface WhyPlatformCopy {
  platforms: Platform[];
  /** Label of the source whose copy they get; `null` when none of their sources ships the id. */
  source: string | null;
  included: boolean;
  reason: string;
}

export interface WhyReport {
  query: string;
  /**
   * In a monorepo, the package (relative to the root passed in) whose own config and detected
   * stacks answered — the one `sync` decides this file against. `null` = that root itself.
   */
  package: string | null;
  /** How the query was resolved; `null` when nothing matched. */
  matchedAs: WhyMatchForm | null;
  /** For an output path, the platform(s) whose target it is. */
  platforms: Platform[];
  /** Set when the query named a copy that a higher-priority source shadows. */
  note: string | null;
  matches: WhyItem[];
  /** Source-resolution warnings (the same ones sync reports). */
  warnings: string[];
}

/** A hypothetical stack version for {@link buildWhyDiff}. */
export interface StackOverride {
  stack: string;
  version: string;
}

export interface WhyDiffEntry {
  kind: ContentKind;
  id: string;
  source: string;
  /** Gate verdict now (`included` or the exclusion reason). */
  before: string;
  /** Gate verdict at the hypothetical version. */
  after: string;
  /** Under scoped `extends` entries, the platforms this copy is synced for. */
  platforms?: Platform[];
}

export interface WhyDiffReport {
  overrides: Array<{ stack: string; from: string | null; to: string }>;
  added: WhyDiffEntry[];
  removed: WhyDiffEntry[];
  unchanged: { included: number; excluded: number };
  warnings: string[];
}

/** A source item as sync sees it, before gating. */
interface ResolvedItem {
  kind: ContentKind;
  id: string;
  /** `x.md` for files, the dir name for skills — the key `mergeContentKind` returns. */
  key: string;
  /** Dir the winning copy was found in (`<source>/rules`, `<source>/skills`, …). */
  kindDir: string;
  sourceIndex: number;
  frontmatter: Record<string, unknown>;
  /** Frontmatter could not be parsed; sync rejects such a guardrail outright. */
  readError: string | null;
}

/** Platforms that read the same sources, with each content kind merged over those sources. */
interface WhyView {
  platforms: Platform[];
  merged: Map<ContentKind, Map<string, string>>;
}

interface WhyContext {
  root: string;
  config: BlueprintConfig;
  platforms: Platform[];
  sources: SyncSource[];
  /** One per group of platforms reading the same sources (one in total without scoped `extends`). */
  views: WhyView[];
  /** Per source (by index), per kind: the keys that source ships, by sync's own predicates. */
  shipped: Array<Map<ContentKind, Set<string>>>;
  items: ResolvedItem[];
  stackMap: StackMap;
  platformMap: PlatformMap;
  detected: DetectedStacks;
  warnings: string[];
  /** Paths under `plugins/` the bundle platforms write an item to. */
  bundleOutputs: ReturnType<typeof createBundleOutputResolver>;
}

function loadWhyContext(root: string): WhyContext {
  const config = dropLegacyGeminiRulesTarget(loadConfig(root), () => {});
  const resolved = resolveSyncSources(root, config);
  const platforms = configuredPlatforms(config);
  // The sources sync reads for some platform: a scoped `extends` entry for none of them is unused.
  const sources = activeSources(resolved.sources, platforms);
  const dirs = sources.map((s) => s.dir);
  const items: ResolvedItem[] = [];
  for (const kind of CONTENT_KINDS) {
    for (const [key, kindDir] of mergeContentKind(dirs, kind)) {
      const sourceIndex = dirs.findIndex((d) => join(d, kind) === kindDir);
      items.push({ kind, key, kindDir, sourceIndex, ...readItem(kind, kindDir, key) });
    }
  }
  const catalog = loadCatalogSync(root);
  const stackPackages = buildStackPackages(catalog);
  const shipped = dirs.map(
    (dir) => new Map(CONTENT_KINDS.map((kind) => [kind, new Set(mergeContentKind([dir], kind).keys())])),
  );
  const views = resolveSourceViews(sources, platforms).map((view) => {
    const viewDirs = view.sources.map((s) => s.dir);
    return {
      platforms: view.platforms,
      merged: new Map(CONTENT_KINDS.map((kind) => [kind, mergeContentKind(viewDirs, kind)])),
    };
  });
  return {
    root,
    config,
    platforms,
    sources,
    views,
    shipped,
    items,
    stackMap: buildStackMap(catalog),
    platformMap: buildPlatformMap(catalog),
    bundleOutputs: createBundleOutputResolver(config, platforms, root, catalog),
    detected: detectStacks(root, config, stackPackages.packages),
    // The catalog stack-map lines are worded exactly as sync warns them.
    warnings: [...resolved.warnings, ...stackPackages.issues.map((w) => `catalog ${w}`)],
  };
}

function itemFile(kind: ContentKind, kindDir: string, key: string): string {
  return kind === 'skills' ? join(kindDir, key, 'SKILL.md') : join(kindDir, key);
}

function readItem(
  kind: ContentKind,
  kindDir: string,
  key: string,
): Pick<ResolvedItem, 'id' | 'frontmatter' | 'readError'> {
  const id = kind === 'skills' ? key : key.replace(/\.md$/, '');
  try {
    const { data } = matter.read(itemFile(kind, kindDir, key));
    return { id, frontmatter: data as Record<string, unknown>, readError: null };
  } catch (err) {
    // Sync gates an unreadable rule/agent/skill as stack-agnostic and rejects an unreadable guardrail.
    return { id, frontmatter: {}, readError: err instanceof Error ? err.message : String(err) };
  }
}

/** Project-relative, forward-slash path — the form users type and JSON consumers compare. */
function toProjectPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

/**
 * Generated paths sync writes for an item, by platform (whether or not the item is included). A
 * path several platforms read (a shared skills dir, `AGENTS.md`) is listed once per platform.
 * `platforms` defaults to those some of whose sources ship the item.
 */
function candidateOutputs(
  ctx: WhyContext,
  item: ResolvedItem,
  platforms: readonly Platform[] = platformsShipping(ctx, item),
): Array<{ platform: Platform; path: string }> {
  if (item.kind === 'guardrails') return [];
  const out: Array<{ platform: Platform; path: string }> = [];
  const push = (platform: Platform, path: string): void => {
    out.push({ platform, path: toProjectPath(ctx.root, join(ctx.root, path)) });
  };
  if (item.kind === 'skills') {
    // The dirs sync picks for this skill, with every platform that loads each: Cursor reads
    // `.claude/skills/` when that is written for it, and gets a Cursor-only skill in its own dir.
    const outputs = skillDirsFor(
      resolveSkillOutputs(ctx.config, platforms),
      platformGateFor(ctx, item).platforms,
    );
    for (const output of outputs)
      for (const reader of output.platforms) push(reader, `${output.target.dir}/${item.id}/SKILL.md`);
    pushBundleOutputs(ctx, item, platforms, push);
    return out;
  }
  const targets = item.kind === 'rules' ? resolveRuleTargets : resolveAgentTargets;
  for (const [platform, t] of targets(ctx.config, platforms)) push(platform, `${t.dir}/${item.id}${t.ext}`);
  if (item.kind === 'rules') {
    for (const p of AGENTS_MD_RULE_PLATFORMS) if (platforms.includes(p)) push(p, 'AGENTS.md');
  }
  if (item.kind === 'agents' && platforms.includes('codex')) push('codex', `.codex/agents/${item.id}.toml`);
  pushBundleOutputs(ctx, item, platforms, push);
  return out;
}

/** The `plugins/<name>/` paths of the bundle platforms among `platforms` (already platform-gated). */
function pushBundleOutputs(
  ctx: WhyContext,
  item: ResolvedItem,
  platforms: readonly Platform[],
  push: (platform: Platform, path: string) => void,
): void {
  if (item.kind === 'guardrails') return;
  for (const bundle of ctx.bundleOutputs(item.kind, item.key, item.kindDir)) {
    if (platforms.includes(bundle.platform)) push(bundle.platform, bundle.path);
  }
}

function toDetection(det: DetectedStack | undefined): WhyDetection | null {
  if (!det) return null;
  return { version: det.version, confidence: det.confidence, source: det.source };
}

function stackChecks(gate: StackGate, detected: DetectedStacks): WhyStackCheck[] {
  return Object.entries(gate.constraint).map(([stack, range]) => {
    const det = detected.get(stack);
    return {
      stack,
      range,
      detected: toDetection(det),
      satisfied: det !== undefined && versionSatisfies(det.version, range),
      lowConfidence: gate.match.lowConfidence.includes(stack),
    };
  });
}

/**
 * The verdict for an item under `detected`: `null` = included, else the exclusion reason. An item
 * that passes the version gate but is limited to platforms this project does not sync is excluded
 * too: sync writes nothing for it.
 */
function exclusionReason(
  ctx: WhyContext,
  item: ResolvedItem,
  gate: StackGate,
  platformGate: PlatformGate,
  platforms: readonly Platform[] = ctx.platforms,
): string | null {
  const invalid = guardrailIssue(item);
  if (invalid !== null) return `rejected by sync: ${invalid}`;
  if (!gate.matched) return gate.reason;
  if (item.kind === 'guardrails' && isEmptyList(item.frontmatter.platforms)) {
    return '`platforms: []` — a guardrail with an empty list is compiled for no platform';
  }
  if (item.kind === 'guardrails') return guardrailPlatformReason(ctx, platformGate, platforms);
  if (allowsAnyPlatform(platformGate.platforms, platforms)) return null;
  const limited = `limited to ${(platformGate.platforms ?? []).join(', ')}`;
  // A subset is one source view's platforms (scoped `extends`), not everything the project syncs.
  if (platforms.length < ctx.platforms.length) return `${limited} — not written for ${platforms.join(', ')}`;
  return `${limited} — this project syncs ${platforms.join(', ')}`;
}

/**
 * Only some platforms compile guardrails, and `claude-marketplace` is not one of them: a guardrail
 * compiled for no configured host writes nothing, so `why` must not call it included.
 */
function guardrailPlatformReason(
  ctx: WhyContext,
  platformGate: PlatformGate,
  platforms: readonly Platform[] = ctx.platforms,
): string | null {
  const hosts = GUARDRAIL_PLATFORMS.filter((p) => platforms.includes(p));
  if (hosts.length === 0) {
    return `no configured platform compiles guardrails (they compile for ${GUARDRAIL_PLATFORMS.join(', ')}; this project syncs ${platforms.join(', ')})`;
  }
  if (allowsAnyPlatform(platformGate.platforms, hosts)) return null;
  return `limited to ${(platformGate.platforms ?? []).join(', ')} — of this project's platforms, guardrails compile for ${hosts.join(', ')}`;
}

function isEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function platformGateFor(ctx: WhyContext, item: ResolvedItem): PlatformGate {
  return resolvePlatformGate(item.id, item.kindDir, item.frontmatter, ctx.platformMap);
}

/**
 * Generated paths sync writes for an included item: a path any of whose platforms is allowed.
 * `platforms` narrows it to one source view's platforms under scoped `extends` entries.
 */
function writtenOutputs(
  ctx: WhyContext,
  item: ResolvedItem,
  list: string[] | null,
  platforms?: readonly Platform[],
): string[] {
  const outputs = candidateOutputs(ctx, item, platforms).filter((o) => allowsPlatform(list, o.platform));
  return dedupe(outputs.map((o) => o.path));
}

function guardrailIssue(item: ResolvedItem): string | null {
  if (item.kind !== 'guardrails') return null;
  return item.readError ?? guardrailValidationIssue(item.frontmatter);
}

function gateFor(ctx: WhyContext, item: ResolvedItem, detected: DetectedStacks): StackGate {
  return evaluateStackGate(item.id, item.kindDir, item.frontmatter, ctx.stackMap, detected);
}

function includedReason(gate: StackGate): string {
  if (gate.constraintSource === 'none') return 'stack-agnostic — applies to every project';
  if (Object.keys(gate.constraint).length === 0) return 'declares `stacks: {}` — explicitly stack-agnostic';
  const parts = Object.entries(gate.constraint).map(([stack, range]) => `${stack} ${range}`);
  return `stack constraint satisfied (${parts.join('; ')})`;
}

function ships(ctx: WhyContext, sourceIndex: number, item: ResolvedItem): boolean {
  return ctx.shipped[sourceIndex]?.get(item.kind)?.has(item.key) ?? false;
}

/** The item's file inside source `i` (whether or not that source ships it). */
function copyPath(ctx: WhyContext, sourceIndex: number, item: ResolvedItem): string {
  return itemFile(item.kind, join(ctx.sources[sourceIndex].dir, item.kind), item.key);
}

function shadowedCopies(ctx: WhyContext, item: ResolvedItem): Array<{ label: string; path: string }> {
  return ctx.sources.flatMap((source, i) =>
    i !== item.sourceIndex && ships(ctx, i, item)
      ? [{ label: source.label, path: toProjectPath(ctx.root, copyPath(ctx, i, item)) }]
      : [],
  );
}

/**
 * A matched item and, under scoped `extends` entries, the platforms it is explained for: the copy
 * those platforms sync (`missing` when none of their sources ships the id). `scope: null` explains
 * the highest-priority copy for every platform.
 */
interface MatchedItem {
  item: ResolvedItem;
  scope: Platform[] | null;
  missing?: boolean;
}

function explainItem(ctx: WhyContext, { item, scope, missing = false }: MatchedItem): WhyItem {
  const platforms = scope ?? ctx.platforms;
  const gate = gateFor(ctx, item, ctx.detected);
  const platformGate = platformGateFor(ctx, item);
  const excluded = missing
    ? `no source synced for ${platforms.join(', ')} ships it`
    : exclusionReason(ctx, item, gate, platformGate, platforms);
  const source = ctx.sources[item.sourceIndex];
  const scoped = scopedOutputs(ctx, item, excluded, platformGate, scope);
  const verdict = headlineVerdict(
    excluded ?? includedReason(gate),
    excluded === null,
    scope,
    scoped.byPlatform,
  );
  return {
    kind: item.kind,
    id: item.id,
    ...verdict,
    source: {
      origin: source?.origin ?? 'local',
      label: source?.label ?? 'unknown',
      path: toProjectPath(ctx.root, itemFile(item.kind, item.kindDir, item.key)),
    },
    shadowed: shadowedCopies(ctx, item),
    constraint: {
      source: gate.constraintSource,
      pack: readSourcePackName(dirname(item.kindDir)) ?? null,
      stacks: stackChecks(gate, ctx.detected),
    },
    invalidRanges: gate.issues,
    platforms: {
      source: platformGate.source,
      list: platformGate.platforms,
      skipped: skippedPlatforms(ctx.config, platforms, item.kind, platformGate.platforms),
      unknown: platformGate.unknown,
      invalid: platformGate.invalid,
    },
    invalid: guardrailIssue(item),
    ...scoped,
  };
}

/**
 * The headline verdict. For an id asked about without a platform, when platforms get different
 * copies (or verdicts), it says so instead of speaking for the highest-priority copy alone.
 */
function headlineVerdict(
  reason: string,
  included: boolean,
  scope: Platform[] | null,
  byPlatform: WhyPlatformCopy[] | null,
): Pick<WhyItem, 'included' | 'reason'> {
  if (scope !== null || byPlatform === null) return { included, reason };
  const parts = byPlatform.map(
    (c) => `${c.included ? 'included' : 'excluded'} for ${c.platforms.join(', ')}`,
  );
  return { included: byPlatform.some((c) => c.included), reason: `differs by platform: ${parts.join('; ')}` };
}

/** The platforms some of whose sources ship the item (every platform without scoped `extends`). */
function platformsShipping(ctx: WhyContext, item: ResolvedItem): Platform[] {
  return ctx.views.filter((view) => view.merged.get(item.kind)?.has(item.key)).flatMap((v) => v.platforms);
}

/** The copy of `item`'s id that `view` syncs: the item itself, another copy, or `null` for none. */
function copyIn(ctx: WhyContext, item: ResolvedItem, view: WhyView): ResolvedItem | null {
  const kindDir = view.merged.get(item.kind)?.get(item.key);
  if (kindDir === undefined) return null;
  if (kindDir === item.kindDir) return item;
  return {
    ...item,
    kindDir,
    sourceIndex: ctx.sources.findIndex((s) => join(s.dir, item.kind) === kindDir),
    ...readItem(item.kind, kindDir, item.key),
  };
}

/** Each view's own copy of the item and its verdict; `null` source when the view has no copy. */
function viewCopies(
  ctx: WhyContext,
  item: ResolvedItem,
): Array<WhyPlatformCopy & { copy: ResolvedItem | null; list: string[] | null }> {
  return ctx.views.map((view) => {
    const copy = copyIn(ctx, item, view);
    if (copy === null) {
      return {
        platforms: view.platforms,
        source: null,
        included: false,
        reason: 'no source for these platforms ships it',
        copy: null,
        list: null,
      };
    }
    const gate = gateFor(ctx, copy, ctx.detected);
    const platformGate = platformGateFor(ctx, copy);
    const excluded = exclusionReason(ctx, copy, gate, platformGate, view.platforms);
    return {
      platforms: view.platforms,
      source: ctx.sources[copy.sourceIndex]?.label ?? 'unknown',
      included: excluded === null,
      reason: excluded ?? includedReason(gate),
      copy,
      list: platformGate.platforms,
    };
  });
}

/**
 * Outputs come from each view's own copy: under scoped `extends` entries a platform may get a
 * lower-priority copy, or none. `byPlatform` is reported only when the views disagree.
 */
function scopedOutputs(
  ctx: WhyContext,
  item: ResolvedItem,
  excluded: string | null,
  platformGate: PlatformGate,
  scope: Platform[] | null,
): Pick<WhyItem, 'outputs' | 'byPlatform'> {
  if (ctx.views.length === 1) {
    return {
      outputs:
        excluded === null ? writtenOutputs(ctx, item, platformGate.platforms) : bundledOutputs(ctx, item),
      byPlatform: null,
    };
  }
  const copies = viewCopies(ctx, item);
  if (scope !== null) {
    const agree = copies.every((c) => c.source === copies[0].source && c.included === copies[0].included);
    return {
      outputs:
        excluded === null
          ? writtenOutputs(ctx, item, platformGate.platforms, scope)
          : bundledOutputs(ctx, item),
      byPlatform: agree ? null : copies.map(({ copy: _copy, list: _list, ...rest }) => rest),
    };
  }
  const outputs = copies.flatMap(({ copy, included, platforms, list }) =>
    copy && included ? writtenOutputs(ctx, copy, list, platforms) : [],
  );
  const agree = copies.every((c) => c.source === copies[0].source && c.included === copies[0].included);
  return {
    outputs: dedupe(outputs),
    byPlatform: agree ? null : copies.map(({ copy: _copy, list: _list, ...rest }) => rest),
  };
}

/**
 * Bundles are gated by profile and stack name, not by the project's detected versions, so an item
 * the project gate excludes is still written into the bundles it matches.
 */
function bundledOutputs(ctx: WhyContext, item: ResolvedItem): string[] {
  if (item.kind === 'guardrails') return [];
  return dedupe(
    ctx
      .bundleOutputs(item.kind, item.key, item.kindDir)
      .map((b) => toProjectPath(ctx.root, join(ctx.root, b.path))),
  );
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Forward-slash form of a relative path, without `./` prefixes or trailing slashes. */
function cleanRelative(path: string): string {
  return path
    .split(sep)
    .join('/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
}

/**
 * `abs` relative to `base`. When the plain form escapes `base` but both exist, retry on real paths,
 * so a symlinked root (macOS `/tmp` → `/private/tmp`) still matches the paths sync works with.
 */
function relativeTo(base: string, abs: string): string {
  const rel = relative(base, abs);
  if (!rel.startsWith('..') || !existsSync(abs) || !existsSync(base)) return rel;
  return relative(realpathSync(base), realpathSync(abs));
}

interface QueryMatch {
  form: WhyMatchForm;
  items: MatchedItem[];
  platforms: Platform[];
  note: string | null;
}

/** A source path: the winning copy, or a shadowed copy (reported with a note). */
function matchSourcePath(ctx: WhyContext, query: string): QueryMatch | null {
  for (const item of ctx.items) {
    for (let i = 0; i < ctx.sources.length; i++) {
      if (!ships(ctx, i, item)) continue;
      const file = copyPath(ctx, i, item);
      const paths = [toProjectPath(ctx.root, file)];
      if (item.kind === 'skills') paths.push(toProjectPath(ctx.root, dirname(file)));
      if (!paths.includes(query)) continue;
      const scoped = ctx.views.length > 1 ? matchScopedSource(ctx, item, i, query) : null;
      if (scoped) return scoped;
      const note =
        i === item.sourceIndex
          ? null
          : `${query} is shadowed: sync uses the ${ctx.sources[item.sourceIndex]?.label ?? 'higher-priority'} copy instead, explained below`;
      return { form: 'source', items: [{ item, scope: null }], platforms: [], note };
    }
  }
  return null;
}

/**
 * Under scoped `extends` entries, a source copy that some views sync is explained for exactly those
 * platforms, even when a scoped higher-priority copy wins elsewhere. `null` when no view syncs it.
 */
function matchScopedSource(ctx: WhyContext, item: ResolvedItem, i: number, query: string): QueryMatch | null {
  const kindDir = join(ctx.sources[i].dir, item.kind);
  const using = ctx.views.filter((view) => view.merged.get(item.kind)?.get(item.key) === kindDir);
  if (using.length === 0) return null;
  const scope = using.flatMap((view) => view.platforms);
  const copy =
    kindDir === item.kindDir
      ? item
      : { ...item, kindDir, sourceIndex: i, ...readItem(item.kind, kindDir, item.key) };
  const others = ctx.platforms.filter((p) => !scope.includes(p));
  const note =
    others.length > 0
      ? `${query} is the copy sync uses for ${scope.join(', ')}; ${others.join(', ')} get another copy or none`
      : null;
  return {
    form: 'source',
    items: [{ item: copy, scope: using.length === ctx.views.length ? null : scope }],
    platforms: scope,
    note,
  };
}

/**
 * The item for each platform group an output path hit: under scoped `extends` entries, the copy that
 * group syncs (or `missing`), so the verdict is the one for the platform whose file was named.
 */
function outputMatches(
  ctx: WhyContext,
  item: ResolvedItem,
  hitPlatforms: readonly Platform[],
): MatchedItem[] {
  if (ctx.views.length === 1) return [{ item, scope: null }];
  return ctx.views.flatMap((view) => {
    const scope = view.platforms.filter((p) => hitPlatforms.includes(p));
    if (scope.length === 0) return [];
    const copy = copyIn(ctx, item, view);
    return [{ item: copy ?? item, scope, missing: copy === null }];
  });
}

function matchOutputPath(ctx: WhyContext, query: string): QueryMatch | null {
  const items: MatchedItem[] = [];
  const platforms: Platform[] = [];
  for (const item of ctx.items) {
    // Every configured platform: a path for a platform that does not get the item still resolves.
    const hits = candidateOutputs(ctx, item, ctx.platforms).filter(
      (o) => o.path === query || o.path === `${query}/SKILL.md`,
    );
    if (hits.length === 0) continue;
    // AGENTS.md carries every rule's block — it names no single rule, so it is not an item path.
    if (hits.every((h) => h.path === 'AGENTS.md')) continue;
    items.push(
      ...outputMatches(
        ctx,
        item,
        hits.map((h) => h.platform),
      ),
    );
    platforms.push(...hits.map((h) => h.platform));
  }
  if (items.length === 0) return null;
  return { form: 'output', items, platforms: dedupe(platforms), note: null };
}

const KIND_PREFIX = /^(rules|agents|skills|guardrails)\/(.+)$/;

/** A bare id (`x`, `x.md`) or a kind-qualified one (`rules/x`), across every kind. */
function matchId(ctx: WhyContext, query: string): QueryMatch | null {
  const prefixed = KIND_PREFIX.exec(query);
  const kind = prefixed ? (prefixed[1] as ContentKind) : null;
  const id = (prefixed ? prefixed[2] : query).replace(/\/SKILL\.md$/, '').replace(/\.md$/, '');
  const items = ctx.items.filter((item) => item.id === id && (kind === null || item.kind === kind));
  if (items.length === 0) return null;
  return { form: 'id', items: items.map((item) => ({ item, scope: null })), platforms: [], note: null };
}

export interface WhyOptions {
  /**
   * The caller's working directory. A relative `<file>` is read against the project root first and,
   * if that matches nothing, against `cwd` — so a shell-completed path works whatever the root.
   */
  cwd?: string;
}

/** Package config dirs below `root` (a monorepo's workspace map), deepest first. */
function nestedPackages(root: string): string[] {
  const start = resolve(root);
  return discoverConfigDirs(start)
    .filter((dir) => dir !== start)
    .sort((a, b) => b.length - a.length);
}

/** The deepest package dir containing `abs`, or `root` when none does. */
function owningProject(root: string, packages: string[], abs: string): string {
  return packages.find((dir) => !relativeTo(dir, abs).startsWith('..')) ?? resolve(root);
}

/** Root-relative, then cwd-relative absolute readings of a path-like query. */
function queryPaths(root: string, query: string, cwd: string | undefined): string[] {
  const paths = [resolve(root, query)];
  if (cwd !== undefined && resolve(cwd, query) !== paths[0]) paths.push(resolve(cwd, query));
  return paths;
}

function monorepoWarning(root: string, packages: string[]): string {
  const names = packages.map((dir) => relative(root, dir).split(sep).join('/')).sort();
  return (
    `monorepo: ${names.length} package(s) have their own config (${names.join(', ')}); this answers ` +
    'for the root config only, while sync decides each package against its own detected stacks — ' +
    'pass a path inside the package, or the package directory'
  );
}

/**
 * Build the `why <file>` report. `<file>` may be a source path, a generated path, or an id. In a
 * monorepo, a path inside a package is answered by that package's config — the one sync uses.
 */
export function buildWhyReport(root: string, query: string, options: WhyOptions = {}): WhyReport {
  const packages = nestedPackages(root);
  const contexts = new Map<string, WhyContext>();
  const contextFor = (dir: string): WhyContext => {
    const cached = contexts.get(dir);
    if (cached) return cached;
    const ctx = loadWhyContext(dir);
    contexts.set(dir, ctx);
    return ctx;
  };

  const trimmed = query.trim();
  for (const abs of queryPaths(root, trimmed, options.cwd)) {
    const project = owningProject(root, packages, abs);
    const ctx = contextFor(project);
    const rel = cleanRelative(relativeTo(project, abs));
    const match = matchSourcePath(ctx, rel) ?? matchOutputPath(ctx, rel);
    if (match) return toReport(ctx, query, match, project === resolve(root) ? null : relative(root, project));
  }

  const ctx = contextFor(resolve(root));
  const match = matchId(ctx, cleanRelative(trimmed));
  const report = toReport(ctx, query, match, null);
  if (packages.length > 0) report.warnings.push(monorepoWarning(root, packages));
  return report;
}

function toReport(ctx: WhyContext, query: string, match: QueryMatch | null, pkg: string | null): WhyReport {
  return {
    query,
    package: pkg === null ? null : pkg.split(sep).join('/'),
    matchedAs: match?.form ?? null,
    platforms: match?.platforms ?? [],
    note: match?.note ?? null,
    matches: (match?.items ?? []).map((matched) => explainItem(ctx, matched)),
    warnings: [...ctx.warnings],
  };
}

/**
 * Parse a `stack@version` spec. A partial version (`4`, `4.2`) is completed the way the gate
 * compares it (`4.0.0`), so the report shows the exact version that was matched.
 */
export function parseStackOverride(spec: string): StackOverride {
  const at = spec.lastIndexOf('@');
  const stack = at > 0 ? spec.slice(0, at).trim() : '';
  const raw = at > 0 ? spec.slice(at + 1).trim() : '';
  if (!stack || !raw) throw new Error(`expected <stack>@<version>, got "${spec}" (e.g. payload@4)`);
  const version = valid(raw) ?? coerce(raw, { includePrerelease: true })?.version;
  if (!version) throw new Error(`"${raw}" in "${spec}" is not a version (e.g. payload@4 or payload@4.2.1)`);
  return { stack, version };
}

/**
 * What the resolved rule set would gain and lose if the given stacks were at these versions.
 * Read-only: re-runs sync's gate with a substituted detection map; nothing is written.
 */
export function buildWhyDiff(root: string, overrides: StackOverride[]): WhyDiffReport {
  const ctx = loadWhyContext(root);
  const hypothetical: DetectedStacks = new Map(ctx.detected);
  for (const o of overrides) {
    hypothetical.set(o.stack, { version: o.version, confidence: 'declared', source: '--diff' });
  }

  const report: WhyDiffReport = {
    overrides: overrides.map((o) => ({
      stack: o.stack,
      from: ctx.detected.get(o.stack)?.version ?? null,
      to: o.version,
    })),
    added: [],
    removed: [],
    unchanged: { included: 0, excluded: 0 },
    warnings: [...ctx.warnings, ...unknownStackWarnings(ctx, overrides)],
  };
  const packages = nestedPackages(root);
  if (packages.length > 0) report.warnings.push(monorepoWarning(root, packages));

  for (const { item, platforms } of diffCopies(ctx)) {
    const platformGate = platformGateFor(ctx, item);
    const before = exclusionReason(ctx, item, gateFor(ctx, item, ctx.detected), platformGate, platforms);
    const after = exclusionReason(ctx, item, gateFor(ctx, item, hypothetical), platformGate, platforms);
    if ((before === null) === (after === null)) {
      if (before === null) report.unchanged.included++;
      else report.unchanged.excluded++;
      continue;
    }
    const entry: WhyDiffEntry = {
      kind: item.kind,
      id: item.id,
      source: ctx.sources[item.sourceIndex]?.label ?? 'unknown',
      before: before ?? 'included',
      after: after ?? 'included',
      ...(ctx.views.length > 1 ? { platforms } : {}),
    };
    (after === null ? report.added : report.removed).push(entry);
  }
  return report;
}

/**
 * The copies `--diff` gates: every item for every platform, or under scoped `extends` entries each
 * source view's own copies for that view's platforms (so an item may appear once per view).
 */
function diffCopies(ctx: WhyContext): Array<{ item: ResolvedItem; platforms: Platform[] }> {
  if (ctx.views.length === 1) return ctx.items.map((item) => ({ item, platforms: ctx.platforms }));
  return ctx.views.flatMap((view) =>
    ctx.items.flatMap((item) => {
      const copy = copyIn(ctx, item, view);
      return copy ? [{ item: copy, platforms: view.platforms }] : [];
    }),
  );
}

/**
 * A stack that is neither detected nor named by any constraint cannot change the set, so an
 * override of it is almost always a typo (`Payload@4`, `next@15` for `nextjs`) — say so rather
 * than reporting a reassuring "no change".
 */
function unknownStackWarnings(ctx: WhyContext, overrides: StackOverride[]): string[] {
  const gated = new Set(
    ctx.items.flatMap((item) => Object.keys(gateFor(ctx, item, ctx.detected).constraint)),
  );
  return overrides
    .filter((o) => !ctx.detected.has(o.stack) && !gated.has(o.stack))
    .map((o) => {
      const known = [...new Set([...ctx.detected.keys(), ...gated])].sort();
      const hint = known.length > 0 ? ` (known stacks: ${known.join(', ')})` : '';
      return `--diff ${o.stack}: not detected and no rule, agent, skill or guardrail is gated on it — check the stack id${hint}`;
    });
}

// ---------------------------------------------------------------------------
// Human formatting (the CLI prints these lines; `--json` prints the report itself)
// ---------------------------------------------------------------------------

const MATCH_FORM_LABEL: Record<WhyMatchForm, string> = {
  source: 'source path',
  output: 'generated output path',
  id: 'id',
};

function describeConstraintSource(item: WhyItem): string {
  if (item.constraint.source === 'frontmatter') return 'frontmatter `stacks:` (version-precise)';
  if (item.constraint.source === 'catalog') {
    return `catalog pack-level tag of ${item.constraint.pack ?? 'its pack'} (name-only, any version)`;
  }
  return 'none — stack-agnostic';
}

function describeCheck(check: WhyStackCheck): string {
  const mark = check.satisfied ? '✔' : '✘';
  if (!check.detected) return `${mark} ${check.stack} "${check.range}" — not detected in this project`;
  const d = check.detected;
  const low = check.lowConfidence ? ' — low confidence: pin a version in bluetemberg.config.json' : '';
  return `${mark} ${check.stack} "${check.range}" vs ${d.version} (${d.confidence}, from ${d.source})${low}`;
}

function formatItem(item: WhyItem): string[] {
  const lines = [
    `${item.kind}/${item.id}: ${item.included ? 'INCLUDED' : 'EXCLUDED'} — ${item.reason}`,
    `  source:     ${item.source.label} (${item.source.path})`,
  ];
  for (const s of item.shadowed) lines.push(`  shadowed:   ${s.label} (${s.path}) — ignored, lower priority`);
  lines.push(`  constraint: ${describeConstraintSource(item)}`);
  for (const check of item.constraint.stacks) lines.push(`    ${describeCheck(check)}`);
  for (const issue of item.invalidRanges)
    lines.push(`  WARN: invalid stack range ${issue} — the file is mis-gated`);
  lines.push(...formatPlatforms(item));
  for (const c of item.byPlatform ?? []) {
    const verdict = c.included ? 'INCLUDED' : 'EXCLUDED';
    lines.push(`  for ${c.platforms.join(', ')}: ${verdict} — ${c.source ?? 'no copy'}: ${c.reason}`);
  }
  if (item.included || item.outputs.length > 0) {
    const outputs =
      item.kind === 'guardrails'
        ? 'compiled into hook settings'
        : item.outputs.join(', ') || '(none for these platforms)';
    lines.push(`  outputs:    ${outputs}`);
  }
  return lines;
}

function formatPlatforms(item: WhyItem): string[] {
  const { source, list, skipped, unknown, invalid } = item.platforms;
  const lines = invalid ? [`  WARN: ${invalid}`] : [];
  if (list !== null) {
    const from =
      source === 'frontmatter'
        ? 'frontmatter `platforms:`'
        : `catalog platforms of ${item.constraint.pack ?? 'its pack'}`;
    lines.push(`  platforms:  ${list.join(', ')} (${from})`);
  }
  if (list !== null && skipped.length > 0) lines.push(`    skipped for: ${skipped.join(', ')}`);
  if (unknown.length > 0)
    lines.push(`  WARN: unknown platform(s) ${unknown.join(', ')} — they match nothing`);
  return lines;
}

/** Human-readable lines for a {@link WhyReport}. */
export function formatWhyReport(report: WhyReport): string[] {
  const lines = report.warnings.map((w) => `WARN: ${w}`);
  if (report.matchedAs === null) {
    lines.push(
      `No rule, agent, skill or guardrail matches "${report.query}" (tried source path, generated path, and id).`,
    );
    return lines;
  }
  const platforms = report.platforms.length > 0 ? ` (${report.platforms.join(', ')})` : '';
  lines.push(`"${report.query}" matched as ${MATCH_FORM_LABEL[report.matchedAs]}${platforms}.`);
  if (report.package)
    lines.push(`Answered for package ${report.package} (its own config and detected stacks).`);
  if (report.note) lines.push(report.note);
  for (const item of report.matches) lines.push('', ...formatItem(item));
  return lines;
}

/** Human-readable lines for a {@link WhyDiffReport}. */
export function formatWhyDiff(report: WhyDiffReport): string[] {
  const lines = report.warnings.map((w) => `WARN: ${w}`);
  const moves = report.overrides.map((o) => `${o.stack} ${o.from ?? '(not detected)'} → ${o.to}`);
  lines.push(`If ${moves.join(', ')} (nothing is written):`);
  if (report.added.length === 0 && report.removed.length === 0) {
    lines.push('  no change to the resolved set');
  }
  const forPlatforms = (e: WhyDiffEntry): string => (e.platforms ? ` for ${e.platforms.join(', ')}` : '');
  for (const e of report.added)
    lines.push(`  + ${e.kind}/${e.id} [${e.source}]${forPlatforms(e)} — was: ${e.before}`);
  for (const e of report.removed)
    lines.push(`  - ${e.kind}/${e.id} [${e.source}]${forPlatforms(e)} — ${e.after}`);
  lines.push(`  unchanged: ${report.unchanged.included} included, ${report.unchanged.excluded} excluded`);
  return lines;
}
