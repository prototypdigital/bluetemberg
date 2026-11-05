import { loadCatalogSync } from '../catalog/index.js';
import { sanitizeForTerminal } from '../registry/scanner.js';
import { buildStackPackages, packageForStack } from '../stacks/packages.js';
import { checkDraft, type Citation, type DraftCheckReport, type DraftIssue } from './check.js';
import { fetchPublicPage, type PageFetcher } from './fetch.js';

/**
 * Citation verification (M7 phase 2, #197). Phase 1 checks that a citation is well-formed; this
 * checks that it is *true*: the cited page is fetched and the quote must appear on it. A model
 * that invents a plausible docs URL, or paraphrases and calls it a quote, fails here.
 *
 * It also asks where the stack's own documentation lives (the npm package's `homepage` and
 * `repository`) and warns when a citation comes from anywhere else — a blog or a mirror is not a
 * primary source, however accurate it looks.
 */

export type CitationStatus = 'verified' | 'quote-not-found' | 'unreachable';

export interface CitationCheck {
  url: string;
  status: CitationStatus;
  /** Why it is unreachable; null otherwise. */
  detail: string | null;
  /** The citation's host is the package's homepage or repository; null when that is unknown. */
  primarySource: boolean | null;
}

export interface DocSources {
  /** Homepage host without `www.` — the citation host must equal it or be a subdomain. */
  hosts: string[];
  /** `github.com/owner/repo`-style prefixes from the package's repository field. */
  repoPrefixes: string[];
}

export type DocSourcesLookup = (pkg: string) => Promise<DocSources>;

export interface VerifyOptions {
  fetchPage?: PageFetcher;
  fetchDocSources?: DocSourcesLookup;
}

export interface CitationVerification {
  checks: CitationCheck[];
  errors: DraftIssue[];
  warnings: DraftIssue[];
}

const NPM_REGISTRY = 'https://registry.npmjs.org';
const DOC_SOURCES_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Quote matching
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const point =
      code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

const HIDDEN_ELEMENTS = ['script', 'style', 'noscript', 'template'];

/** The hidden element a tag at `i` opens (`<script …`), if any. `lower` is the page lower-cased. */
function hiddenElementAt(lower: string, i: number): string | null {
  for (const name of HIDDEN_ELEMENTS) {
    if (!lower.startsWith(name, i + 1)) continue;
    const next = lower[i + 1 + name.length];
    if (next === undefined || next === '>' || next === '/' || /\s/.test(next)) return name;
  }
  return null;
}

/** Where markup starting at `i` ends (exclusive), or -1 when it never closes. */
function markupEnd(lower: string, i: number): number {
  if (lower.startsWith('<!--', i)) {
    const close = lower.indexOf('-->', i + 4);
    return close === -1 ? -1 : close + 3;
  }
  const hidden = hiddenElementAt(lower, i);
  if (hidden) {
    const close = lower.indexOf(`</${hidden}`, i + 1);
    if (close === -1) return -1;
    const gt = lower.indexOf('>', close);
    return gt === -1 ? -1 : gt + 1;
  }
  const gt = lower.indexOf('>', i + 1);
  return gt === -1 ? -1 : gt + 1;
}

/**
 * Visible text of an HTML (or plain/markdown) page. A single forward pass — every search starts
 * where the last one ended and an unclosed construct ends the scan — so a hostile page cannot make
 * it quadratic (a regex pass over 5 MiB of unclosed `<script` runs for hours).
 */
export function pageToText(page: string): string {
  const lower = page.toLowerCase();
  const parts: string[] = [];
  let i = 0;
  while (i < page.length) {
    const lt = page.indexOf('<', i);
    if (lt === -1) {
      parts.push(page.slice(i));
      break;
    }
    parts.push(page.slice(i, lt), ' ');
    const end = markupEnd(lower, lt);
    if (end === -1) break;
    i = end;
  }
  return decodeEntities(parts.join(''));
}

/**
 * Fold text so a faithful quote matches however the page formats it: NFKC, typographic quotes and
 * dashes to ASCII, markdown emphasis and code marks dropped, whitespace collapsed, lower-cased.
 */
export function foldForQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when `quote` appears in `page` (HTML or text) after folding both. */
export function quoteAppears(quote: string, page: string): boolean {
  const needle = foldForQuote(quote);
  return needle.length > 0 && foldForQuote(pageToText(page)).includes(needle);
}

// ---------------------------------------------------------------------------
// Primary documentation sources
// ---------------------------------------------------------------------------

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function repoPrefix(raw: unknown): string | null {
  const value =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null
        ? (raw as { url?: unknown }).url
        : null;
  if (typeof value !== 'string') return null;
  const shorthand = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(value);
  if (shorthand) return `github.com/${shorthand[1]}/${shorthand[2]}`.toLowerCase();
  const match =
    /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/]+@)?([^/:]+)[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      value,
    );
  if (!match) return null;
  return `${bareHost(match[1])}/${match[2]}/${match[3]}`.toLowerCase();
}

/** Doc sources from an npm version manifest's `homepage` and `repository`. */
export function docSourcesFromManifest(manifest: Record<string, unknown>): DocSources {
  const hosts: string[] = [];
  if (typeof manifest.homepage === 'string') {
    try {
      const url = new URL(manifest.homepage);
      if (url.protocol === 'https:' || url.protocol === 'http:') hosts.push(bareHost(url.hostname));
    } catch {
      // An unparseable homepage contributes nothing.
    }
  }
  const prefix = repoPrefix(manifest.repository);
  // A homepage that is just the repository page says nothing beyond the repository prefix.
  const ownHosts = hosts.filter((h) => !(prefix && h === prefix.split('/')[0]));
  return { hosts: ownHosts, repoPrefixes: prefix ? [prefix] : [] };
}

/** True when `url` is on the package's homepage host (or a subdomain) or under its repository. */
export function isPrimarySource(url: string, sources: DocSources): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = bareHost(parsed.hostname);
  if (sources.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  // raw.githubusercontent.com/<owner>/<repo>/… serves the same repository's files.
  const repoHost = host === 'raw.githubusercontent.com' ? 'github.com' : host;
  const path = `${repoHost}${parsed.pathname}`.toLowerCase();
  return sources.repoPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function encodePackageName(pkg: string): string {
  return pkg.startsWith('@') ? `@${encodeURIComponent(pkg.slice(1))}` : encodeURIComponent(pkg);
}

/** The package's doc sources from the public npm registry (its `latest` manifest — a few KB). */
export const fetchNpmDocSources: DocSourcesLookup = async (pkg) => {
  const res = await fetch(`${NPM_REGISTRY}/${encodePackageName(pkg)}/latest`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(DOC_SOURCES_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`npm registry answered HTTP ${res.status}`);
  const body = await res.text();
  if (body.length > MAX_MANIFEST_BYTES) throw new Error('npm manifest is unexpectedly large');
  const manifest: unknown = JSON.parse(body);
  if (typeof manifest !== 'object' || manifest === null) throw new Error('npm manifest is not an object');
  return docSourcesFromManifest(manifest as Record<string, unknown>);
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function shortReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = sanitizeForTerminal(message.split('\n')[0]);
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function describeSources(sources: DocSources | null): string {
  return [...(sources?.hosts ?? []), ...(sources?.repoPrefixes ?? [])].join(', ');
}

async function loadDocSources(
  pkg: string,
  lookup: DocSourcesLookup,
  warnings: DraftIssue[],
): Promise<DocSources | null> {
  try {
    const sources = await lookup(pkg);
    if (sources.hosts.length > 0 || sources.repoPrefixes.length > 0) return sources;
    warnings.push({ code: 'doc-sources-unknown', message: `npm lists no homepage or repository for ${pkg}` });
  } catch (err) {
    warnings.push({
      code: 'doc-sources-unknown',
      message: `could not look up where ${pkg} documents itself (${shortReason(err)}) — primary sources not checked`,
    });
  }
  return null;
}

async function checkOne(
  citation: Citation,
  fetchPage: PageFetcher,
  pages: Map<string, Promise<string>>,
): Promise<Pick<CitationCheck, 'status' | 'detail'>> {
  let page = pages.get(citation.url);
  if (!page) {
    page = fetchPage(citation.url).then((p) => p.text);
    pages.set(citation.url, page);
  }
  try {
    const text = await page;
    return quoteAppears(citation.quote, text)
      ? { status: 'verified', detail: null }
      : { status: 'quote-not-found', detail: null };
  } catch (err) {
    return { status: 'unreachable', detail: shortReason(err) };
  }
}

/**
 * Fetch every cited page and check its quote; compare each host with the package's doc sources.
 * An unreachable page or a missing quote is an error — an unverifiable citation proves nothing. A
 * citation from outside the package's own docs is a warning, for the human reviewer.
 */
export async function verifyCitations(
  citations: readonly Citation[],
  pkg: string,
  opts: VerifyOptions = {},
): Promise<CitationVerification> {
  const fetchPage = opts.fetchPage ?? fetchPublicPage;
  const errors: DraftIssue[] = [];
  const warnings: DraftIssue[] = [];
  const sources = await loadDocSources(pkg, opts.fetchDocSources ?? fetchNpmDocSources, warnings);
  const pages = new Map<string, Promise<string>>();
  const checks: CitationCheck[] = [];

  for (const [i, citation] of citations.entries()) {
    const result = await checkOne(citation, fetchPage, pages);
    const primarySource = sources ? isPrimarySource(citation.url, sources) : null;
    const url = sanitizeForTerminal(citation.url);
    checks.push({ url, ...result, primarySource });
    const label = `draft.citations[${i}]`;
    if (result.status === 'unreachable') {
      errors.push({
        code: 'citation-unreachable',
        message: `${label}: could not load ${url} — ${result.detail}`,
      });
    }
    if (result.status === 'quote-not-found') {
      errors.push({
        code: 'citation-quote-not-found',
        message: `${label}: the quote does not appear on ${url} — quote the page verbatim`,
      });
    }
    if (primarySource === false) {
      warnings.push({
        code: 'citation-not-primary',
        message: `${label}: ${url} is not ${pkg}'s own documentation (${describeSources(sources)})`,
      });
    }
  }
  if (sources && checks.length > 0 && !checks.some((c) => c.primarySource)) {
    errors.push({
      code: 'citations-no-primary',
      message: `no citation is from ${pkg}'s own documentation — cite at least one page from ${describeSources(sources)}`,
    });
  }
  return { checks, errors, warnings };
}

/** The npm package a draft's gap stack resolves to, by the catalog stack map. */
export function packageForGap(root: string, stack: string): string {
  return packageForStack(stack, buildStackPackages(loadCatalogSync(root)).packages);
}

export interface VerifiedCheckReport extends DraftCheckReport {
  /** Per-citation verification; empty when the draft had no well-formed citations to check. */
  citationChecks: CitationCheck[];
}

/** `draft check --verify-citations`: the static check, plus fetching every cited page. */
export async function checkDraftWithCitations(
  root: string,
  name: string,
  opts: VerifyOptions = {},
  now: Date = new Date(),
): Promise<VerifiedCheckReport> {
  const report = checkDraft(root, name, now);
  if (!report.gap || report.citations.length === 0) return { ...report, citationChecks: [] };
  const verification = await verifyCitations(report.citations, packageForGap(root, report.gap.stack), opts);
  const errors = [...report.errors, ...verification.errors];
  return {
    ...report,
    ok: errors.length === 0,
    errors,
    warnings: [...report.warnings, ...verification.warnings],
    citationChecks: verification.checks,
  };
}
