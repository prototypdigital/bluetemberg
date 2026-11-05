import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';

import { formatFinding, sanitizeForTerminal, scanText } from '../registry/scanner.js';
import { buildCoverageReport } from '../stacks/report.js';
import { isValidStackRange, isWildcardRange, rangeHasUpperBound, versionSatisfies } from '../stacks/match.js';
import { parseStrictFrontmatter } from './frontmatter.js';
import { AGENT_TOOLS, isDraftKind, KIND_SPECS, WRITE_TOOLS, type DraftKind } from './kinds.js';
import { DRAFT_KEY } from './marker.js';
import { assertNoSymlinks, displayPath, draftPath } from './paths.js';

/**
 * `bluetemberg draft check` — validate a draft before a human may promote it. Read-only, and safe
 * for an agent to run in a loop. A draft is model output, so every value read from it is treated
 * as data: messages quote it only sanitised and truncated, and nothing in it is executed.
 */

export const DRAFT_STATUS_UNVETTED = 'draft-unvetted';
export const TODO_MARKER = 'TODO(draft)';
/** The whole draft file. Always-on rules should be far smaller; this bounds every read. */
export const MAX_DRAFT_BYTES = 64 * 1024;
export const MAX_QUOTE_CHARS = 500;
/** A shorter quote matches almost any page, so it proves nothing about the source. */
export const MIN_QUOTE_CHARS = 20;
const MAX_CITATIONS = 20;
const MAX_URL_CHARS = 2000;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_SCOPE_CHARS = 200;
const LOCAL_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Characters a reviewer cannot see but a model reads: Unicode format characters (zero-width,
 * bidi, and the U+E0000 tag block that can spell out whole hidden sentences), private-use
 * characters and variation selectors. None belongs in a rule, so any one is an error.
 */
const HIDDEN_CHARS = /[\p{Cf}\p{Co}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu;

export interface DraftIssue {
  code: string;
  message: string;
}

export interface Citation {
  url: string;
  quote: string;
  retrieved: string;
}

export interface DraftGap {
  stack: string;
  version: string;
  confidence: string | null;
}

export interface DraftCheckReport {
  name: string;
  path: string;
  ok: boolean;
  /** SHA-256 of the exact bytes checked — promotion pins it. */
  sha256: string;
  errors: DraftIssue[];
  warnings: DraftIssue[];
  gap: DraftGap | null;
  citations: Citation[];
  /** The draft's kind; null when it could not be read. */
  kind: DraftKind | null;
}

/** The parts of a valid draft promotion needs. */
export interface ValidDraft {
  kind: DraftKind;
  /** The promoted file's frontmatter: exactly the kind's keys, in house order. */
  frontmatter: Record<string, unknown>;
  stacks: Record<string, string>;
  body: string;
  gap: DraftGap;
  citations: Citation[];
  draft: Record<string, unknown>;
  /** For an agent: the tools it declares. */
  tools: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A draft-sourced value, safe to put in a message. */
export function quoteValue(value: unknown, max = 80): string {
  const text = sanitizeForTerminal(
    typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)),
  );
  return JSON.stringify(text.length > max ? `${text.slice(0, max)}…` : text);
}

class Issues {
  errors: DraftIssue[] = [];
  warnings: DraftIssue[] = [];
  error(code: string, message: string): void {
    this.errors.push({ code, message });
  }
  warn(code: string, message: string): void {
    this.warnings.push({ code, message });
  }
}

function checkText(issues: Issues, field: string, value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.error(`${field}-missing`, `"${field}" must be a non-empty string`);
    return null;
  }
  if (value.length > max) issues.error(`${field}-too-long`, `"${field}" is longer than ${max} characters`);
  if (/[\r\n]/.test(value)) issues.error(`${field}-multiline`, `"${field}" must be a single line`);
  return value.trim();
}

function checkGap(issues: Issues, draft: Record<string, unknown>): DraftGap | null {
  const gap = draft.gap;
  if (!isPlainObject(gap) || typeof gap.stack !== 'string' || typeof gap.version !== 'string') {
    issues.error('gap-missing', '"draft.gap" must record the stack and version this draft fills');
    return null;
  }
  const confidence = typeof gap.confidence === 'string' ? gap.confidence : null;
  if (confidence === 'coerced' || confidence === 'unknown') {
    issues.warn(
      'gap-low-confidence',
      `the gap version was detected at ${quoteValue(confidence)} confidence — confirm it before promoting`,
    );
  }
  return { stack: gap.stack, version: gap.version, confidence };
}

function checkDraftBlock(issues: Issues, value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    issues.error(
      'draft-block-missing',
      '"draft" must be a mapping (status, kind, gap, reviewedBy, citations)',
    );
    return null;
  }
  if (value.status !== DRAFT_STATUS_UNVETTED) {
    issues.error(
      'draft-status',
      `"draft.status" must be "${DRAFT_STATUS_UNVETTED}", got ${quoteValue(value.status)}`,
    );
  }
  if (!isDraftKind(value.kind)) {
    issues.error('draft-kind', `"draft.kind" must be rule, skill or agent, got ${quoteValue(value.kind)}`);
  }
  // Review is recorded by `promote`, by a human. A draft that arrives already "reviewed" was
  // written by something trying to look approved.
  if (value.reviewedBy !== null) {
    issues.error(
      'draft-prereviewed',
      '"draft.reviewedBy" must stay null — only `draft promote` records a reviewer',
    );
  }
  return value;
}

function checkStacks(issues: Issues, value: unknown, gap: DraftGap | null): Record<string, string> {
  const stacks: Record<string, string> = {};
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    issues.error('stacks-missing', '"stacks" must map at least the gap stack to a version range');
    return stacks;
  }
  for (const [stack, range] of Object.entries(value)) {
    if (typeof range !== 'string' || !isValidStackRange(range) || isWildcardRange(range)) {
      issues.error(
        'stacks-range',
        `stacks.${quoteValue(stack, 40)} needs a semver range, got ${quoteValue(range)}`,
      );
      continue;
    }
    if (!rangeHasUpperBound(range)) {
      issues.error(
        'stacks-open-ended',
        `stacks.${quoteValue(stack, 40)} range ${quoteValue(range)} has no upper bound`,
      );
    }
    stacks[stack] = range;
  }
  if (!gap) return stacks;
  const gapRange = stacks[gap.stack];
  if (gapRange === undefined) {
    issues.error(
      'stacks-gap-missing',
      `"stacks" must declare a range for the gap stack ${quoteValue(gap.stack)}`,
    );
  } else if (!versionSatisfies(gap.version, gapRange)) {
    issues.error(
      'stacks-gap-uncovered',
      `stacks.${gap.stack} range ${quoteValue(gapRange)} does not cover the gap version ${quoteValue(gap.version)}`,
    );
  }
  return stacks;
}

/** Why `raw` is not an acceptable citation URL, or null. Also applied to every redirect hop. */
export function urlIssue(raw: string): string | null {
  if (raw.length > MAX_URL_CHARS) return 'is too long';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not a URL';
  }
  if (url.protocol !== 'https:') return 'must use https';
  if (url.username || url.password) return 'must not carry credentials';
  if (url.port !== '') return 'must use the default https port';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) !== 0) return 'must name a host, not an IP address';
  if (host === 'localhost' || !host.includes('.') || LOCAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return 'must be a public documentation host';
  }
  return null;
}

function dateIssue(raw: string, now: Date): string | null {
  if (!DATE_PATTERN.test(raw) || Number.isNaN(Date.parse(raw))) return 'must be a YYYY-MM-DD date';
  if (Date.parse(raw) > now.getTime() + DAY_MS) return 'is in the future';
  return null;
}

function checkCitation(issues: Issues, raw: unknown, index: number, now: Date): Citation | null {
  const label = `draft.citations[${index}]`;
  if (!isPlainObject(raw)) {
    issues.error('citation-shape', `${label} must be a mapping with url, quote and retrieved`);
    return null;
  }
  const { url, quote, retrieved } = raw;
  if (typeof url !== 'string' || typeof quote !== 'string' || typeof retrieved !== 'string') {
    issues.error('citation-shape', `${label} needs string url, quote and retrieved`);
    return null;
  }
  const problems = [
    urlIssue(url) && `url ${urlIssue(url)}`,
    quote.trim().length < MIN_QUOTE_CHARS && `quote is shorter than ${MIN_QUOTE_CHARS} characters`,
    quote.length > MAX_QUOTE_CHARS && `quote is longer than ${MAX_QUOTE_CHARS} characters`,
    dateIssue(retrieved, now) && `retrieved ${dateIssue(retrieved, now)}`,
  ].filter((p): p is string => typeof p === 'string');
  if (problems.length > 0) {
    issues.error('citation-invalid', `${label}: ${problems.join('; ')}`);
    return null;
  }
  return { url, quote: quote.trim(), retrieved };
}

function checkCitations(issues: Issues, value: unknown, now: Date): Citation[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.error(
      'citations-missing',
      'at least one citation from primary documentation is required — a draft grounded only in project code stays a draft',
    );
    return [];
  }
  if (value.length > MAX_CITATIONS) issues.error('citations-too-many', `at most ${MAX_CITATIONS} citations`);
  return value
    .slice(0, MAX_CITATIONS)
    .map((raw, i) => checkCitation(issues, raw, i, now))
    .filter((c): c is Citation => c !== null);
}

function checkBody(issues: Issues, body: string, kind: DraftKind): void {
  const spec = KIND_SPECS[kind];
  if (body.trim() === '') issues.error('body-empty', `the ${kind} body is empty`);
  if (Buffer.byteLength(body, 'utf8') > spec.maxBodyBytes) {
    issues.error(
      'body-too-long',
      `the ${kind} body is larger than ${spec.maxBodyBytes / 1024} KiB — split it up`,
    );
  }
  if (!spec.expectedSection.pattern.test(body)) {
    issues.warn(
      'body-missing-section',
      `the body has no "${spec.expectedSection.label}" section (${spec.authoringSkill} house structure)`,
    );
  }
}

/** `name` must be the draft's own name: it becomes the skill dir or agent id. */
function checkName(issues: Issues, value: unknown, name: string): void {
  if (value !== name) {
    issues.error(
      'name-mismatch',
      `"name" must be ${quoteValue(name)} (the draft name), got ${quoteValue(value)}`,
    );
  }
}

/**
 * An agent's tools, from the abstract set only. Required: an agent with no `tools` inherits every
 * tool its host has, which no reviewer can read off the file.
 */
function checkTools(issues: Issues, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.error(
      'tools-missing',
      `"tools" must list the agent's tools (from ${AGENT_TOOLS.join(', ')}) — an agent without it inherits every tool`,
    );
    return [];
  }
  const tools: string[] = [];
  for (const tool of value) {
    if (typeof tool !== 'string' || !(AGENT_TOOLS as readonly string[]).includes(tool)) {
      issues.error('tools-unknown', `tool ${quoteValue(tool, 40)} is not one of ${AGENT_TOOLS.join(', ')}`);
      continue;
    }
    if (!tools.includes(tool)) tools.push(tool);
  }
  const writes = tools.filter((t) => WRITE_TOOLS.has(t));
  if (writes.length > 0) {
    issues.warn(
      'tools-write-access',
      `the agent can ${writes.join(', ')} — confirm it needs more than read and search`,
    );
  }
  return tools;
}

/** The kind-specific fields: `scope` for a rule, `name` for a skill or agent, `tools` for an agent. */
function checkKindFields(
  issues: Issues,
  data: Record<string, unknown>,
  kind: DraftKind,
  name: string,
): { scope: string | null; tools: string[] } {
  if (kind === 'rule') return { scope: checkText(issues, 'scope', data.scope, MAX_SCOPE_CHARS), tools: [] };
  checkName(issues, data.name, name);
  return { scope: null, tools: kind === 'agent' ? checkTools(issues, data.tools) : [] };
}

/**
 * Scanner rules that are always errors in a draft. Pack content may quote these attacks as
 * labelled BAD examples (the scanner then only warns), but a draft is model output: an
 * instruction to an agent, or an exfiltration command, has no business in one — whatever fence it
 * sits in. A rule that genuinely needs to quote one is written by hand.
 */
const DRAFT_BLOCKING_RULES = new Set([
  'prompt-override',
  'disable-safety-controls',
  'dangerous-agent-flag',
  'exfiltration',
  'decode-to-shell',
]);

function scanPath(kind: DraftKind, name: string): string {
  if (kind === 'skill') return `skills/${name}/SKILL.md`;
  return `${kind === 'rule' ? 'rules' : 'agents'}/${name}.md`;
}

function checkScan(issues: Issues, text: string, name: string, kind: DraftKind): void {
  // Scanned at the path it would occupy in a pack (`rules/…`): the scanner relaxes instruction
  // rules for top-level files such as a README, which no draft is.
  for (const finding of scanText(text, scanPath(kind, name))) {
    const message = sanitizeForTerminal(formatFinding(finding));
    if (finding.severity === 'block' || DRAFT_BLOCKING_RULES.has(finding.rule)) {
      issues.error(`scan:${finding.rule}`, message);
      continue;
    }
    issues.warn(`scan:${finding.rule}`, message);
  }
}

function checkHiddenChars(issues: Issues, text: string): void {
  const found = [...new Set(text.match(HIDDEN_CHARS) ?? [])];
  if (found.length === 0) return;
  const codes = found
    .slice(0, 5)
    .map((ch) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`);
  issues.error(
    'hidden-chars',
    `the draft contains characters a reviewer cannot see (${codes.join(', ')}${found.length > 5 ? ', …' : ''}) — remove them`,
  );
}

/**
 * The safety subset of {@link checkDraftText} — hidden characters and blocking scan findings at
 * the kind's pack path — for content that is no longer a draft (a promoted file being contributed).
 */
export function safetyIssues(text: string, name: string, kind: DraftKind): DraftIssue[] {
  const issues = new Issues();
  checkHiddenChars(issues, text);
  checkScan(issues, text, name, kind);
  return issues.errors;
}

export interface CheckedText {
  errors: DraftIssue[];
  warnings: DraftIssue[];
  gap: DraftGap | null;
  citations: Citation[];
  kind: DraftKind | null;
  /** Present only when there are no errors. */
  valid: ValidDraft | null;
}

/** The kind a draft declares, read before full validation so the right key set applies. */
function declaredKind(data: Record<string, unknown> | null): DraftKind {
  const draft = data?.[DRAFT_KEY];
  return isPlainObject(draft) && isDraftKind(draft.kind) ? draft.kind : 'rule';
}

function checkKeys(issues: Issues, data: Record<string, unknown>, kind: DraftKind): void {
  const allowed = new Set([...KIND_SPECS[kind].keys, DRAFT_KEY]);
  for (const key of Object.keys(data)) {
    if (allowed.has(key)) continue;
    issues.error(
      'unknown-key',
      `unknown frontmatter key ${quoteValue(key, 40)} for a ${kind} (allowed: ${[...allowed].join(', ')})`,
    );
  }
}

/** The promoted frontmatter, in the kind's key order. */
function promotedFrontmatter(
  kind: DraftKind,
  fields: {
    name: string;
    description: string;
    scope: string | null;
    tools: string[];
    stacks: Record<string, string>;
  },
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: fields.name,
    description: fields.description,
    scope: fields.scope,
    tools: fields.tools,
    stacks: fields.stacks,
  };
  return Object.fromEntries(KIND_SPECS[kind].keys.map((key) => [key, values[key]]));
}

function parseOrReport(issues: Issues, text: string): { data: Record<string, unknown>; body: string } | null {
  try {
    return parseStrictFrontmatter(text);
  } catch (err) {
    issues.error('parse', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Check one draft's text. Pure — exposed so `promote` checks exactly the bytes it displays. */
export function checkDraftText(text: string, name: string, now: Date = new Date()): CheckedText {
  const issues = new Issues();
  checkHiddenChars(issues, text);
  if (text.includes(TODO_MARKER)) {
    issues.error('todo', `the draft still contains ${TODO_MARKER} markers`);
  }
  const parsed = parseOrReport(issues, text);
  const kind = declaredKind(parsed?.data ?? null);
  checkScan(issues, text, name, kind);
  if (!parsed) {
    return {
      errors: issues.errors,
      warnings: issues.warnings,
      gap: null,
      citations: [],
      kind: null,
      valid: null,
    };
  }

  const { data, body } = parsed;
  checkKeys(issues, data, kind);
  const description = checkText(issues, 'description', data.description, MAX_DESCRIPTION_CHARS);
  const { scope, tools } = checkKindFields(issues, data, kind, name);
  const draft = checkDraftBlock(issues, data[DRAFT_KEY]);
  const gap = draft ? checkGap(issues, draft) : null;
  const stacks = checkStacks(issues, data.stacks, gap);
  const citations = draft ? checkCitations(issues, draft.citations, now) : [];
  checkBody(issues, body, kind);

  const ok = issues.errors.length === 0 && description !== null && draft !== null && gap !== null;
  const valid: ValidDraft | null = ok
    ? {
        kind,
        frontmatter: promotedFrontmatter(kind, { name, description, scope, tools, stacks }),
        stacks,
        body,
        gap,
        citations,
        draft,
        tools,
      }
    : null;
  return { errors: issues.errors, warnings: issues.warnings, gap, citations, kind, valid };
}

/** Read a draft's bytes: name validated, no symlinks, size-capped. */
export function readDraftBytes(root: string, name: string): { path: string; bytes: Buffer } {
  const path = draftPath(root, name);
  assertNoSymlinks(root, path);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) throw new Error(`no draft named "${name}" in .bluetemberg/drafts/`);
  if (!stat.isFile()) throw new Error(`draft "${name}" is not a regular file`);
  if (stat.size > MAX_DRAFT_BYTES)
    throw new Error(`draft "${name}" is larger than ${MAX_DRAFT_BYTES / 1024} KiB`);
  return { path, bytes: readFileSync(path) };
}

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Null when `gap` is still open in `root`; otherwise why it is not. A draft records its own gap,
 * and that record is agent-editable — so the engine re-asks the registry rather than trusting the
 * draft's word that guidance is missing.
 */
export function gapClosedReason(root: string, gap: DraftGap): string | null {
  const report = buildCoverageReport(root, gap.stack, gap.version);
  if (!report.result.covered || report.result.precision === 'name-level') return null;
  return `${quoteValue(`${gap.stack}@${gap.version}`)} is covered by ${quoteValue(report.result.matchedRange)} — the gap this draft was opened for is closed`;
}

/** `bluetemberg draft check <name>` — validate a draft. Throws only when it cannot be read. */
export function checkDraft(root: string, name: string, now: Date = new Date()): DraftCheckReport {
  const { path, bytes } = readDraftBytes(root, name);
  const checked = checkDraftText(bytes.toString('utf8'), name, now);
  const closed = checked.gap ? gapClosedReason(root, checked.gap) : null;
  if (closed) checked.errors.push({ code: 'gap-closed', message: closed });
  return {
    name,
    path: displayPath(root, path),
    ok: checked.errors.length === 0,
    sha256: sha256(bytes),
    errors: checked.errors,
    warnings: checked.warnings,
    gap: checked.gap,
    kind: checked.kind,
    citations: checked.citations.map((c) => ({
      url: sanitizeForTerminal(c.url),
      quote: sanitizeForTerminal(c.quote),
      retrieved: c.retrieved,
    })),
  };
}
