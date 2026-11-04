import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkDraftText } from '../src/drafts/check.js';
import {
  fetchPublicPage,
  isNonPublicAddress,
  publicOnlyLookup,
  type PageFetcher,
} from '../src/drafts/fetch.js';
import { parseStrictFrontmatter } from '../src/drafts/frontmatter.js';
import { promoteDraft, type PromotionReview } from '../src/drafts/promote.js';
import {
  checkDraftWithCitations,
  docSourcesFromManifest,
  foldForQuote,
  isPrimarySource,
  quoteAppears,
  verifyCitations,
  type DocSources,
} from '../src/drafts/verify.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const QUOTE = 'Jobs are stored in the payload-jobs collection.';
const URL_A = 'https://payloadcms.com/docs/jobs-queue/overview';
const PAYLOAD_SOURCES: DocSources = {
  hosts: ['payloadcms.com'],
  repoPrefixes: ['github.com/payloadcms/payload'],
};

const pageWith =
  (html: string): PageFetcher =>
  async (url) => ({ finalUrl: url, text: html });
const sources = async (): Promise<DocSources> => PAYLOAD_SOURCES;

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function draftText(url = URL_A, quote = QUOTE): string {
  return `---
description: Queue background work through the Payload jobs collection.
scope: "src/**"
stacks:
  payload: ">=4 <5"
draft:
  status: draft-unvetted
  kind: rule
  gap:
    stack: payload
    version: 4.0.1
    reason: no-coverage
    confidence: declared
  reviewedBy: null
  citations:
    - url: ${url}
      quote: "${quote}"
      retrieved: 2026-11-03
---

# Payload 4 jobs queue

Jobs held in memory are lost on restart.

## Rules

- Queue background work with \`payload.jobs.queue\`.
`;
}

function setUp(root: string, text = draftText()): void {
  writeFileSync(
    join(root, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['claude'], source: 'llm', targets: {}, stacks: { payload: '4.0.1' } }),
  );
  mkdirSync(join(root, '.bluetemberg', 'drafts'), { recursive: true });
  writeFileSync(join(root, '.bluetemberg', 'drafts', 'payload-4-jobs.md'), text);
}

describe('quote matching', () => {
  it('finds a quote across tags, entities, typographic quotes and code marks', () => {
    const html =
      '<p>Jobs are <em>stored</em> in the <code>payload-jobs</code>\n   collection. Use &ldquo;queue&rdquo;&#8217;s API &amp; more.</p>';
    expect(quoteAppears(QUOTE, html)).toBe(true);
    expect(
      quoteAppears("Use “queue”'s API & more.", html.replace('&ldquo;', '“').replace('&rdquo;', '”')),
    ).toBe(true);
    expect(quoteAppears('Use `payload-jobs` here', 'use payload-jobs here')).toBe(true);
  });

  it('does not match text that only exists in scripts, styles or comments', () => {
    const html = `<script>var s = "${QUOTE}"</script><style>/* ${QUOTE} */</style><!-- ${QUOTE} --><p>other</p>`;
    expect(quoteAppears(QUOTE, html)).toBe(false);
  });

  it('does not match a paraphrase', () => {
    expect(quoteAppears('Jobs live in the payload-jobs collection.', `<p>${QUOTE}</p>`)).toBe(false);
  });

  it('folds whitespace and case', () => {
    expect(foldForQuote('  A\n\tB  ')).toBe('a b');
  });
});

describe('primary documentation sources', () => {
  it('reads homepage and repository from the npm manifest', () => {
    expect(
      docSourcesFromManifest({
        homepage: 'https://www.payloadcms.com',
        repository: { url: 'git+https://github.com/payloadcms/payload.git', directory: 'packages/payload' },
      }),
    ).toEqual(PAYLOAD_SOURCES);
    expect(docSourcesFromManifest({ repository: 'vercel/next.js' }).repoPrefixes).toEqual([
      'github.com/vercel/next.js',
    ]);
  });

  it('drops a homepage that is only the repository host', () => {
    const s = docSourcesFromManifest({
      homepage: 'https://github.com/acme/lib#readme',
      repository: 'git+https://github.com/acme/lib.git',
    });
    expect(s.hosts).toEqual([]);
    expect(isPrimarySource('https://github.com/other/fork/blob/main/README.md', s)).toBe(false);
    expect(isPrimarySource('https://github.com/acme/lib/blob/main/docs/x.md', s)).toBe(true);
  });

  it('accepts the homepage host and its subdomains, nothing that merely ends the same', () => {
    expect(isPrimarySource('https://payloadcms.com/docs', PAYLOAD_SOURCES)).toBe(true);
    expect(isPrimarySource('https://docs.payloadcms.com/x', PAYLOAD_SOURCES)).toBe(true);
    expect(isPrimarySource('https://evilpayloadcms.com/docs', PAYLOAD_SOURCES)).toBe(false);
    expect(isPrimarySource('https://medium.com/payload-tips', PAYLOAD_SOURCES)).toBe(false);
  });
});

describe('verifyCitations', () => {
  const citation = { url: URL_A, quote: QUOTE, retrieved: '2026-11-03' };

  it('verifies a quote that is on the page', async () => {
    const result = await verifyCitations([citation], 'payload', {
      fetchPage: pageWith(`<p>${QUOTE}</p>`),
      fetchDocSources: sources,
    });
    expect(result.errors).toEqual([]);
    expect(result.checks).toEqual([{ url: URL_A, status: 'verified', detail: null, primarySource: true }]);
  });

  it('errors when the quote is missing or the page is unreachable', async () => {
    const missing = await verifyCitations([citation], 'payload', {
      fetchPage: pageWith('<p>something else</p>'),
      fetchDocSources: sources,
    });
    expect(missing.errors.map((e) => e.code)).toEqual(['citation-quote-not-found']);

    const down = await verifyCitations([citation], 'payload', {
      fetchPage: async () => {
        throw new Error('HTTP 404\nsecond line');
      },
      fetchDocSources: sources,
    });
    expect(down.errors.map((e) => e.code)).toEqual(['citation-unreachable']);
    expect(down.checks[0].detail).toBe('HTTP 404');
  });

  it('warns about a non-primary source, and when doc sources are unknown', async () => {
    const blog = { ...citation, url: 'https://someblog.dev/payload-4' };
    const result = await verifyCitations([blog], 'payload', {
      fetchPage: pageWith(QUOTE),
      fetchDocSources: sources,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(['citation-not-primary']);

    const unknown = await verifyCitations([citation], 'payload', {
      fetchPage: pageWith(QUOTE),
      fetchDocSources: async () => {
        throw new Error('offline');
      },
    });
    expect(unknown.warnings.map((w) => w.code)).toEqual(['doc-sources-unknown']);
    expect(unknown.checks[0].primarySource).toBeNull();
  });

  it('fetches a page cited twice only once', async () => {
    const fetchPage = vi.fn(pageWith(`${QUOTE} And a second sentence of the docs.`));
    await verifyCitations(
      [citation, { ...citation, quote: 'And a second sentence of the docs.' }],
      'payload',
      {
        fetchPage,
        fetchDocSources: sources,
      },
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('the guarded fetcher', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['192.168.1.1', true],
    ['::1', true],
    ['fd12::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['not-an-ip', true],
    ['8.8.8.8', false],
    ['2606:4700:4700::1111', false],
  ])('isNonPublicAddress(%s) = %s', (address, expected) => {
    expect(isNonPublicAddress(address)).toBe(expected);
  });

  it('refuses a host that resolves to a non-public address', async () => {
    const err = await new Promise<Error | null>((resolve) =>
      publicOnlyLookup('localhost', {}, (e) => resolve(e)),
    );
    expect(err?.message).toMatch(/non-public address/);
  });

  it('refuses non-https, IP-literal and local URLs before any request', async () => {
    await expect(fetchPublicPage('http://payloadcms.com/docs')).rejects.toThrow(/https/);
    await expect(fetchPublicPage('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/IP address/);
    await expect(fetchPublicPage('https://localhost/x')).rejects.toThrow(/public documentation host/);
  });
});

describe('checkDraftText quote length', () => {
  it('refuses a quote too short to prove anything', () => {
    const result = checkDraftText(draftText(URL_A, 'Jobs'), 'payload-4-jobs', NOW);
    expect(result.errors.find((e) => e.code === 'citation-invalid')?.message).toMatch(/shorter than 20/);
  });
});

describe('checkDraftWithCitations', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    setUp(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('adds per-citation results and fails on an invented quote', async () => {
    const ok = await checkDraftWithCitations(
      root,
      'payload-4-jobs',
      { fetchPage: pageWith(`<p>${QUOTE}</p>`), fetchDocSources: sources },
      NOW,
    );
    expect(ok.ok).toBe(true);
    expect(ok.citationChecks[0].status).toBe('verified');

    const bad = await checkDraftWithCitations(
      root,
      'payload-4-jobs',
      { fetchPage: pageWith('<p>nothing here</p>'), fetchDocSources: sources },
      NOW,
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.code)).toContain('citation-quote-not-found');
  });
});

describe('promote re-verifies citations', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    setUp(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const target = (): string => join(root, 'llm', 'rules', 'payload-4-jobs.md');
  const archive = (): Record<string, unknown> =>
    parseStrictFrontmatter(
      readFileSync(join(root, '.bluetemberg', 'drafts', 'promoted', 'payload-4-jobs.md'), 'utf8'),
    ).data.draft as Record<string, unknown>;

  it('refuses before review when a quote is not on its page', async () => {
    const confirm = vi.fn(async () => true);
    await expect(
      promoteDraft(root, 'payload-4-jobs', {
        reviewedBy: 'jr',
        confirm,
        now: NOW,
        env: {},
        verifyCitations: { fetchPage: pageWith('<p>nope</p>'), fetchDocSources: sources },
      }),
    ).rejects.toThrow(/citation-quote-not-found/);
    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(target())).toBe(false);
  });

  it('shows the verification to the reviewer and records it', async () => {
    let seen: PromotionReview | null = null;
    await promoteDraft(root, 'payload-4-jobs', {
      reviewedBy: 'jr',
      now: NOW,
      env: {},
      verifyCitations: { fetchPage: pageWith(`<p>${QUOTE}</p>`), fetchDocSources: sources },
      confirm: async (review) => {
        seen = review;
        return true;
      },
    });
    expect(seen!.citationChecks).toEqual([
      { url: URL_A, status: 'verified', detail: null, primarySource: true },
    ]);
    expect(archive()).toMatchObject({ citationsVerified: true, reviewedBy: 'jr' });
  });

  it('records a skipped verification and warns the reviewer', async () => {
    let seen: PromotionReview | null = null;
    await promoteDraft(root, 'payload-4-jobs', {
      reviewedBy: 'jr',
      now: NOW,
      env: {},
      verifyCitations: false,
      confirm: async (review) => {
        seen = review;
        return true;
      },
    });
    expect(seen!.citationChecks).toBeNull();
    expect(seen!.warnings.map((w) => w.code)).toContain('citations-not-verified');
    expect(archive()).toMatchObject({ citationsVerified: false });
  });
});
