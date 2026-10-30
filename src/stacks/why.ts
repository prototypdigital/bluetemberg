import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { coerce, valid } from 'semver';
import { loadCatalogSync } from '../catalog/index.js';
import { readSourcePackName } from '../catalog/ownership.js';
import type { BlueprintConfig, Platform } from '../types.js';
import { loadConfig } from '../sync/index.js';
import { dropLegacyGeminiRulesTarget } from '../sync/gemini.js';
import { guardrailValidationIssue } from '../sync/guardrails.js';
import { AGENTS_MD_RULE_PLATFORMS } from '../sync/codex.js';
import {
  CONTENT_KINDS,
  mergeContentKind,
  resolveSyncSources,
  type ContentKind,
  type SourceOrigin,
  type SyncSource,
} from '../sync/sources.js';
import {
  DEFAULT_SYNC_PLATFORMS,
  normalizePlatforms,
  resolveAgentTargets,
  resolveRuleTargets,
  resolveSkillTargets,
} from '../sync/targets.js';
import { detectStacks } from './detect.js';
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
  /** Why sync rejects this guardrail before gating (invalid frontmatter/regex), else `null`. */
  invalid: string | null;
  /** Generated paths (relative to the root) sync writes for it; empty when excluded. */
  outputs: string[];
}

export interface WhyReport {
  query: string;
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

interface WhyContext {
  root: string;
  config: BlueprintConfig;
  platforms: Platform[];
  sources: SyncSource[];
  /** Per source (by index), per kind: the keys that source ships, by sync's own predicates. */
  shipped: Array<Map<ContentKind, Set<string>>>;
  items: ResolvedItem[];
  stackMap: StackMap;
  detected: DetectedStacks;
  warnings: string[];
}

function loadWhyContext(root: string): WhyContext {
  const config = dropLegacyGeminiRulesTarget(loadConfig(root), () => {});
  const resolved = resolveSyncSources(root, config);
  const dirs = resolved.sources.map((s) => s.dir);
  const items: ResolvedItem[] = [];
  for (const kind of CONTENT_KINDS) {
    for (const [key, kindDir] of mergeContentKind(dirs, kind)) {
      const sourceIndex = dirs.findIndex((d) => join(d, kind) === kindDir);
      items.push({ kind, key, kindDir, sourceIndex, ...readItem(kind, kindDir, key) });
    }
  }
  const shipped = dirs.map(
    (dir) => new Map(CONTENT_KINDS.map((kind) => [kind, new Set(mergeContentKind([dir], kind).keys())])),
  );
  return {
    root,
    config,
    platforms: normalizePlatforms(config.platforms || DEFAULT_SYNC_PLATFORMS),
    sources: resolved.sources,
    shipped,
    items,
    stackMap: buildStackMap(loadCatalogSync(root)),
    detected: detectStacks(root, config),
    warnings: resolved.warnings,
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

/** Generated paths sync writes for an item, by platform (whether or not the item is included). */
function candidateOutputs(ctx: WhyContext, item: ResolvedItem): Array<{ platform: Platform; path: string }> {
  if (item.kind === 'guardrails') return [];
  const out: Array<{ platform: Platform; path: string }> = [];
  const push = (platform: Platform, path: string): void => {
    out.push({ platform, path: toProjectPath(ctx.root, join(ctx.root, path)) });
  };
  if (item.kind === 'skills') {
    for (const [platform, t] of resolveSkillTargets(ctx.config, ctx.platforms))
      push(platform, `${t.dir}/${item.id}/SKILL.md`);
    return out;
  }
  const targets = item.kind === 'rules' ? resolveRuleTargets : resolveAgentTargets;
  for (const [platform, t] of targets(ctx.config, ctx.platforms))
    push(platform, `${t.dir}/${item.id}${t.ext}`);
  if (item.kind === 'rules') {
    for (const p of AGENTS_MD_RULE_PLATFORMS) if (ctx.platforms.includes(p)) push(p, 'AGENTS.md');
  }
  if (item.kind === 'agents' && ctx.platforms.includes('codex'))
    push('codex', `.codex/agents/${item.id}.toml`);
  return out;
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

/** The gate verdict for an item under `detected`: `null` = included, else the exclusion reason. */
function exclusionReason(item: ResolvedItem, gate: StackGate): string | null {
  const invalid = guardrailIssue(item);
  if (invalid !== null) return `rejected by sync: ${invalid}`;
  return gate.matched ? null : gate.reason;
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

function explainItem(ctx: WhyContext, item: ResolvedItem): WhyItem {
  const gate = gateFor(ctx, item, ctx.detected);
  const excluded = exclusionReason(item, gate);
  const source = ctx.sources[item.sourceIndex];
  return {
    kind: item.kind,
    id: item.id,
    included: excluded === null,
    reason: excluded ?? includedReason(gate),
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
    invalid: guardrailIssue(item),
    outputs: excluded === null ? dedupe(candidateOutputs(ctx, item).map((o) => o.path)) : [],
  };
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Normalize a user-typed path to project-relative forward-slash form. */
function normalizeQuery(root: string, query: string): string {
  const trimmed = query.trim();
  const rel = isAbsolute(trimmed) ? relative(root, trimmed) : trimmed;
  return rel
    .split(sep)
    .join('/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
}

interface QueryMatch {
  form: WhyMatchForm;
  items: ResolvedItem[];
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
      const note =
        i === item.sourceIndex
          ? null
          : `${query} is shadowed: sync uses the ${ctx.sources[item.sourceIndex]?.label ?? 'higher-priority'} copy instead, explained below`;
      return { form: 'source', items: [item], platforms: [], note };
    }
  }
  return null;
}

function matchOutputPath(ctx: WhyContext, query: string): QueryMatch | null {
  const items: ResolvedItem[] = [];
  const platforms: Platform[] = [];
  for (const item of ctx.items) {
    const hits = candidateOutputs(ctx, item).filter(
      (o) => o.path === query || o.path === `${query}/SKILL.md`,
    );
    if (hits.length === 0) continue;
    // AGENTS.md carries every rule's block — it names no single rule, so it is not an item path.
    if (hits.every((h) => h.path === 'AGENTS.md')) continue;
    items.push(item);
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
  return { form: 'id', items, platforms: [], note: null };
}

/** Build the `why <file>` report. `<file>` may be a source path, a generated path, or an id. */
export function buildWhyReport(root: string, query: string): WhyReport {
  const ctx = loadWhyContext(root);
  const normalized = normalizeQuery(root, query);
  const match =
    matchSourcePath(ctx, normalized) ?? matchOutputPath(ctx, normalized) ?? matchId(ctx, normalized);
  return {
    query,
    matchedAs: match?.form ?? null,
    platforms: match?.platforms ?? [],
    note: match?.note ?? null,
    matches: (match?.items ?? []).map((item) => explainItem(ctx, item)),
    warnings: ctx.warnings,
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
    warnings: ctx.warnings,
  };

  for (const item of ctx.items) {
    const before = exclusionReason(item, gateFor(ctx, item, ctx.detected));
    const after = exclusionReason(item, gateFor(ctx, item, hypothetical));
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
    };
    (after === null ? report.added : report.removed).push(entry);
  }
  return report;
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
  if (item.included) {
    const outputs =
      item.kind === 'guardrails'
        ? 'compiled into hook settings'
        : item.outputs.join(', ') || '(none for these platforms)';
    lines.push(`  outputs:    ${outputs}`);
  }
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
  for (const e of report.added) lines.push(`  + ${e.kind}/${e.id} [${e.source}] — was: ${e.before}`);
  for (const e of report.removed) lines.push(`  - ${e.kind}/${e.id} [${e.source}] — ${e.after}`);
  lines.push(`  unchanged: ${report.unchanged.included} included, ${report.unchanged.excluded} excluded`);
  return lines;
}
