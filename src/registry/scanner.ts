import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Content scanner for installed packs (issue #41).
 *
 * Pack content is instructions an AI agent will follow and scripts a hook may run, so a
 * compromised or malicious pack is a supply-chain attack even when its tarball is signed.
 * This is a regex-only pre-flight: it runs after extraction, before the integrity marker is
 * written, and returns findings — it never prints. The command module decides how to log.
 *
 * Two severities, chosen for false-positive cost:
 * - `block` — high confidence: a real-looking credential, an upload of local secrets to a
 *   network sink, or an instruction to switch off hooks/guardrails/verification. Install aborts.
 * - `warn` — patterns rule packs legitimately quote as BAD examples (`rm -rf`, `curl | sh`,
 *   `--no-verify`, writing `.env`). Reported, never fatal.
 */

export type ScanSeverity = 'block' | 'warn';

export interface ScanFinding {
  /** Stable rule id, e.g. `secret-github-token`. */
  rule: string;
  severity: ScanSeverity;
  /** Path relative to the scanned directory, `/`-separated. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Human-readable reason. */
  message: string;
  /** The offending line, trimmed, truncated, with credential-shaped tokens masked. */
  excerpt: string;
}

export interface ScanResult {
  findings: ScanFinding[];
  /** True when there are no findings at all. */
  clean: boolean;
  /** True when at least one finding has `block` severity. */
  blocked: boolean;
  /** Files scanned (text files only). */
  filesScanned: number;
}

interface LineRule {
  id: string;
  severity: ScanSeverity;
  message: string;
  test: (line: string) => boolean;
}

/** Engine-written cache markers and the preserved tarball — not pack content. */
const SKIPPED_FILE_PREFIX = '.bluetemberg-';
/** Content larger than this is reported, not regex-scanned (keeps scan time bounded). */
const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;
/** Lines longer than this are scanned in their first N chars only (regex cost cap). */
const MAX_SCANNED_LINE_CHARS = 8 * 1024;
const BINARY_SNIFF_BYTES = 8000;
const EXCERPT_CHARS = 160;
/** Shannon entropy (bits/char) below which a credential-shaped token is a placeholder. */
const MIN_SECRET_ENTROPY = 3.0;

/** Invisible characters an attacker can use to split a keyword past a regex. */
const INVISIBLE_CHARS = /[­᠎​-‏⁠-⁤﻿]/g;
/** Bidirectional overrides ("Trojan Source"): render text in a different order than it is read. */
const BIDI_CONTROL_CHARS = /[‪-‮⁦-⁩]/;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: ReadonlyArray<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'secret-aws-access-key', label: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    id: 'secret-github-token',
    label: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  {
    id: 'secret-llm-api-key',
    label: 'OpenAI/Anthropic API key',
    pattern: /\bsk-(?:ant-(?:api|admin)\d{2}-|proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g,
  },
  { id: 'secret-stripe-key', label: 'Stripe live key', pattern: /\b[sr]k_live_[A-Za-z0-9]{24,}\b/g },
  { id: 'secret-slack-token', label: 'Slack token', pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: 'secret-npm-token', label: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'secret-google-api-key', label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const PLACEHOLDER_HINT = /x{4,}|EXAMPLE|\.\.\.|your|dummy|fake|placeholder|redacted|<|>|\*{3,}/i;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** A credential-shaped token that is clearly a doc placeholder (`ghp_xxxx…`, `AKIA…EXAMPLE`). */
export function isPlaceholderSecret(token: string): boolean {
  if (PLACEHOLDER_HINT.test(token)) return true;
  return shannonEntropy(token) < MIN_SECRET_ENTROPY;
}

function findSecrets(line: string): Array<{ id: string; label: string }> {
  const hits: Array<{ id: string; label: string }> = [];
  for (const { id, label, pattern } of SECRET_PATTERNS) {
    for (const match of line.matchAll(pattern)) {
      if (isPlaceholderSecret(match[0])) continue;
      hits.push({ id, label });
      break;
    }
  }
  return hits;
}

const PRIVATE_KEY_HEADER =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/;
/** A private-key header only counts when real key material follows it. */
const KEY_BODY_LINE = /^[A-Za-z0-9+/=]{40,}$/;

// ---------------------------------------------------------------------------
// Exfiltration
// ---------------------------------------------------------------------------

const NETWORK_SINK = /\b(?:curl|wget|nc|ncat|netcat|socat|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const SENSITIVE_SOURCE =
  /(?:^|[\s"'=@/(<$:])(?:~\/|\$HOME\/)?(?:\.env\b(?!\.example|\.sample|\.template)|\.ssh\/|id_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.npmrc\b|\.netrc\b|\.pgpass\b|\.git-credentials\b|\.docker\/config\.json|\/etc\/(?:passwd|shadow)\b|\.kube\/config|\bprintenv\b|\benv\s*\||\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)\b)/;
const UPLOAD_FLAG =
  /(?:\s-[a-zA-Z]*[dFT]\b|--data(?:-binary|-raw|-urlencode)?\b|--form\b|--upload-file\b|--post-(?:file|data)\b|--body-data\b|-InFile\b|-Body\b)/;
const PIPE_INTO_SINK = /\|\s*(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|socat)\b/i;
const LOCAL_TARGET_ONLY = /(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/;
const EXTERNAL_URL = /\bhttps?:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s"'`)]+/i;

/** A command that moves local secrets into a network client pointed somewhere external. */
export function isExfiltration(line: string): boolean {
  if (!NETWORK_SINK.test(line)) return false;
  if (!SENSITIVE_SOURCE.test(line)) return false;
  if (!UPLOAD_FLAG.test(line) && !PIPE_INTO_SINK.test(line)) return false;
  if (LOCAL_TARGET_ONLY.test(line) && !EXTERNAL_URL.test(line)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Instructions to switch off safety controls
// ---------------------------------------------------------------------------

const DISABLE_VERB =
  /\b(?:disable|turn(?:ing)?\s+off|bypass|circumvent|deactivate|remove|delete|uninstall|skip|ignore)\b/gi;
const SAFETY_CONTROL =
  /\b(?:guardrails?|(?:pre-?commit|git|claude|cursor|security|PreToolUse|PostToolUse)\s+hooks?|hooks?\s+(?:entirely|completely)|husky|signature\s+verification|integrity\s+checks?|security\s+(?:scan(?:ner|ning)?|checks?|tools?)|bluetemberg\s+(?:scan|guardrails?|verify))\b/i;
/** Words that turn "disable the hooks" into "never disable the hooks". */
const NEGATION =
  /\b(?:never|don'?t|do\s+not|does\s+not|must\s+not|mustn'?t|should\s+not|shouldn'?t|cannot|can'?t|won'?t|no\s+(?:way|one)|avoid|refuse|forbid(?:den)?|prohibit(?:ed)?|prevent|block(?:s|ed)?|without|instead\s+of|rather\s+than|not\s+allowed|unless)\b/i;
/** Agent-CLI flags that remove every permission prompt / sandbox. */
const DANGEROUS_AGENT_FLAG =
  /(?:^|\s)--(?:dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox|yolo)\b/i;
/** The classic prompt-injection opener. */
const OVERRIDE_PHRASE =
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions|rules|guidance|prompts?)\b/i;
/** A quoted span: the phrase is being cited ("watch for 'ignore previous instructions'"), not issued. */
const QUOTED_SPAN = /"[^"]*"|'[^']*'|`[^`]*`|\u201C[^\u201D]*\u201D/g;
/** Mentions of switches that weaken this engine's or the agent's checks — legitimate in docs. */
const WEAKENING_SWITCH = /(?:--skip-(?:scan|signature-verification)\b|"?disableAllHooks"?\s*:\s*true)/i;

function withoutQuotedSpans(line: string): string {
  return line.replace(QUOTED_SPAN, (span) => ' '.repeat(span.length));
}

/** A dangerous agent flag used in a line that does not warn against it. */
export function usesDangerousAgentFlag(line: string): boolean {
  const match = DANGEROUS_AGENT_FLAG.exec(line);
  if (!match) return false;
  return !NEGATION.test(line.slice(0, match.index));
}

/** "Ignore previous instructions" issued, not quoted or warned about. */
export function isPromptOverride(line: string): boolean {
  const match = OVERRIDE_PHRASE.exec(withoutQuotedSpans(line));
  if (!match) return false;
  return !NEGATION.test(line.slice(0, match.index));
}

/**
 * What may precede the verb in its clause for it to read as an order to the agent: nothing
 * (list marker / sentence start) or an imperative lead-in. "Blank issues bypass the
 * guardrails" (descriptive, subject first) does not qualify; "Then bypass the guardrails" does.
 */
const IMPERATIVE_LEAD_IN =
  /^[\s\-*>#\d.)`"'(]*(?:(?:please|then|first|next|now|always|just|and|also|simply|finally|step\s+\d+:?|you\s+(?:should|must|can|may|need\s+to|have\s+to|will\s+need\s+to)|make\s+sure\s+(?:to|you)|be\s+sure\s+to|remember\s+to|feel\s+free\s+to|go\s+ahead\s+and|it\s+is\s+(?:fine|ok|okay|safe)\s+to)[\s,:]+)*$/i;
const CLAUSE_BOUNDARY = /[.;:!?](?:\s|$)|\s[-–—]\s/g;

function clauseBefore(line: string, index: number): string {
  let start = 0;
  for (const m of line.slice(0, index).matchAll(CLAUSE_BOUNDARY)) start = m.index + m[0].length;
  return line.slice(start, index);
}

/** An imperative to switch off hooks/guardrails/verification that is not itself negated. */
export function isSafetyBypassInstruction(line: string): boolean {
  for (const verb of line.matchAll(DISABLE_VERB)) {
    const after = line.slice(verb.index, verb.index + verb[0].length + 60);
    if (!SAFETY_CONTROL.test(after)) continue;
    const lead = clauseBefore(line, verb.index);
    if (NEGATION.test(lead)) continue;
    if (IMPERATIVE_LEAD_IN.test(lead)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

const BIDI_MESSAGE = 'Contains bidirectional control characters (text renders differently than it reads)';

const LINE_RULES: readonly LineRule[] = [
  {
    id: 'exfiltration',
    severity: 'block',
    message: 'Uploads local secrets (.env, SSH/cloud credentials, secret env vars) to a network endpoint',
    test: isExfiltration,
  },
  {
    id: 'disable-safety-controls',
    severity: 'block',
    message: 'Instructs the agent to disable hooks, guardrails, permissions, or verification',
    test: isSafetyBypassInstruction,
  },
  {
    id: 'dangerous-agent-flag',
    severity: 'block',
    message:
      'Runs an AI agent with permissions/sandbox disabled (`--dangerously-skip-permissions` and similar)',
    test: usesDangerousAgentFlag,
  },
  {
    id: 'prompt-override',
    severity: 'block',
    message: 'Prompt-injection phrase telling the agent to ignore its previous instructions',
    test: isPromptOverride,
  },
  {
    id: 'rm-rf',
    severity: 'warn',
    message: 'Recursive force delete (`rm -rf`)',
    test: (line) =>
      /\brm\s+(?:-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/i.test(
        line,
      ),
  },
  {
    id: 'pipe-to-shell',
    severity: 'warn',
    message: 'Pipes a downloaded script straight into a shell',
    test: (line) =>
      /\b(?:curl|wget|iwr|irm)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\|\s*iex\b/i.test(line),
  },
  {
    id: 'write-secrets-file',
    severity: 'warn',
    message: 'Writes to a secrets file (.env, .npmrc, SSH/cloud credentials)',
    test: (line) =>
      /(?:>>?|\btee\s+(?:-a\s+)?)\s*["']?(?:[\w.~$/-]*\/)?(?:\.env(?!\.(?:example|sample|template)\b)(?:\.[\w-]+)?|\.npmrc|\.netrc|\.git-credentials|authorized_keys|\.aws\/credentials)\b/.test(
        line,
      ),
  },
  {
    id: 'skip-git-hooks',
    severity: 'warn',
    message: 'Skips git hooks (`--no-verify`)',
    test: (line) => /(?:^|\s)--no-verify\b/.test(line),
  },
  {
    id: 'weakens-verification',
    severity: 'warn',
    message:
      'Mentions a switch that weakens verification (`--skip-scan`, `--skip-signature-verification`, `disableAllHooks`)',
    test: (line) => WEAKENING_SWITCH.test(line),
  },
];

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function maskSecrets(line: string): string {
  let masked = line;
  for (const { pattern } of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (token) => `${token.slice(0, 6)}…[redacted]`);
  }
  return masked;
}

function toExcerpt(line: string): string {
  const masked = maskSecrets(line.trim());
  return masked.length > EXCERPT_CHARS ? `${masked.slice(0, EXCERPT_CHARS)}…` : masked;
}

/** Strip zero-width/soft-hyphen characters so `rm` + U+200B + ` -rf` still matches. */
export function normalizeForScan(line: string): string {
  return line.replace(INVISIBLE_CHARS, '').slice(0, MAX_SCANNED_LINE_CHARS);
}

function finding(
  rule: string,
  severity: ScanSeverity,
  message: string,
  file: string,
  line: number,
  raw: string,
): ScanFinding {
  return { rule, severity, file, line, message, excerpt: toExcerpt(raw) };
}

function scanPrivateKeys(lines: readonly string[], file: string): ScanFinding[] {
  const found: ScanFinding[] = [];
  lines.forEach((line, i) => {
    if (!PRIVATE_KEY_HEADER.test(line)) return;
    const next = (lines[i + 1] ?? '').trim();
    if (!KEY_BODY_LINE.test(next)) return;
    found.push(finding('secret-private-key', 'block', 'Embeds a private key', file, i + 1, line));
  });
  return found;
}

/**
 * Top-level files (README, CHANGELOG, LICENSE, package.json) are never synced to an agent, so
 * prose there cannot instruct one — a private pack's README may legitimately tell humans to
 * pass `--skip-signature-verification`. Instruction-type findings there warn instead of block.
 * Credentials and exfiltration commands block everywhere.
 */
const INSTRUCTION_RULES = new Set(['disable-safety-controls', 'prompt-override', 'dangerous-agent-flag']);

function severityIn(file: string, severity: ScanSeverity, rule: string): ScanSeverity {
  if (severity === 'block' && INSTRUCTION_RULES.has(rule) && !file.includes('/')) return 'warn';
  return severity;
}

function scanLine(raw: string, file: string, lineNo: number): ScanFinding[] {
  const found: ScanFinding[] = [];
  if (BIDI_CONTROL_CHARS.test(raw)) {
    found.push(finding('bidi-control-chars', 'block', BIDI_MESSAGE, file, lineNo, raw));
  }
  const line = normalizeForScan(raw);
  for (const { id, label } of findSecrets(line)) {
    found.push(finding(id, 'block', `Embeds what looks like a real ${label}`, file, lineNo, raw));
  }
  for (const rule of LINE_RULES) {
    if (!rule.test(line)) continue;
    found.push(finding(rule.id, severityIn(file, rule.severity, rule.id), rule.message, file, lineNo, raw));
  }
  return found;
}

/**
 * Scan one file's text. Exported for tests; `file` is only used to label findings.
 */
export function scanText(text: string, file: string): ScanFinding[] {
  const lines = text.split(/\r?\n/);
  const findings = lines.flatMap((raw, i) => scanLine(raw, file, i + 1));
  findings.push(...scanPrivateKeys(lines, file));
  return findings;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full));
      continue;
    }
    if (entry.isFile() && !entry.name.startsWith(SKIPPED_FILE_PREFIX)) files.push(full);
  }
  return files;
}

function oversizeFinding(file: string): ScanFinding {
  return {
    rule: 'oversize-file',
    severity: 'warn',
    file,
    line: 0,
    message: `File is larger than ${MAX_SCANNED_FILE_BYTES / (1024 * 1024)} MB and was not scanned`,
    excerpt: '',
  };
}

/**
 * Scan every text file under `dir` (an extracted pack) for unsafe patterns.
 * Never prints; never throws for content — only for an unreadable directory.
 */
export function scanPackContent(dir: string): ScanResult {
  const findings: ScanFinding[] = [];
  let filesScanned = 0;

  for (const full of listFiles(dir)) {
    const file = relative(dir, full).split(sep).join('/');
    if (statSync(full).size > MAX_SCANNED_FILE_BYTES) {
      findings.push(oversizeFinding(file));
      continue;
    }
    const buffer = readFileSync(full);
    if (isBinary(buffer)) continue;
    filesScanned++;
    findings.push(...scanText(buffer.toString('utf8'), file));
  }

  return {
    findings,
    clean: findings.length === 0,
    blocked: findings.some((f) => f.severity === 'block'),
    filesScanned,
  };
}

/** One line per finding, for the command module (or an error message) to print. */
export function formatFinding(f: ScanFinding): string {
  const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  const excerpt = f.excerpt ? ` — ${f.excerpt}` : '';
  return `[${f.rule}] ${where}: ${f.message}${excerpt}`;
}

/** Most findings listed in one message; the rest are counted. */
const MAX_LISTED_FINDINGS = 20;

/** Format findings as indented lines, capped so a hostile pack cannot flood the terminal. */
export function formatFindings(findings: readonly ScanFinding[], indent = '  '): string[] {
  const lines = findings.slice(0, MAX_LISTED_FINDINGS).map((f) => `${indent}${formatFinding(f)}`);
  const hidden = findings.length - MAX_LISTED_FINDINGS;
  if (hidden > 0) lines.push(`${indent}…and ${hidden} more`);
  return lines;
}

/** The error message for a pack the scan refused. */
export function formatBlockedScan(label: string, result: ScanResult): string {
  const blocking = result.findings.filter((f) => f.severity === 'block');
  const warnings = result.findings.length - blocking.length;
  return [
    `Security scan blocked "${label}": ${blocking.length} blocking finding(s)` +
      (warnings > 0 ? ` (+${warnings} warning(s))` : '') +
      '. The pack was not installed.',
    ...formatFindings(blocking),
    "If you trust this pack's source (e.g. a private registry you control), re-run with --skip-scan.",
  ].join('\n');
}
