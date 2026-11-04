import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { sanitizeForTerminal } from '../registry/scanner.js';
import {
  checkDraftText,
  gapClosedReason,
  readDraftBytes,
  sha256,
  type Citation,
  type DraftIssue,
  type ValidDraft,
} from './check.js';
import { promotionTarget } from './draft.js';
import { renderFrontmatter } from './frontmatter.js';
import { DRAFT_KEY } from './marker.js';
import { assertNoSymlinks, displayPath, promotedDir, promotedPath } from './paths.js';

/**
 * `bluetemberg draft promote` — the human gate. The library does the checks and the writes; the
 * decision comes from `confirm`, which the CLI implements as an interactive prompt on a TTY. There
 * is no other caller: no MCP tool, no `--yes`.
 *
 * The bytes shown to the reviewer are pinned by hash. After confirmation the draft is re-read, and
 * promotion aborts if a single byte changed — so nothing can edit the draft between what the human
 * approved and what gets written.
 */

export interface PromotionReview {
  name: string;
  /** Where the rule will be written, relative to the project root. */
  destination: string;
  /** The exact rule file that will be written, sanitised for display. */
  output: string;
  sha256: string;
  gap: { stack: string; version: string };
  citations: Citation[];
  warnings: DraftIssue[];
}

export interface PromoteOptions {
  reviewedBy: string;
  /** Show `review` to a human and return their decision. */
  confirm: (review: PromotionReview) => Promise<boolean>;
  now?: Date;
}

export interface PromoteResult {
  name: string;
  promoted: boolean;
  destination: string;
  archived: string | null;
  sha256: string;
}

const MAX_REVIEWER_CHARS = 100;

function assertReviewer(reviewedBy: string): string {
  const who = reviewedBy.trim();
  if (
    who === '' ||
    who.length > MAX_REVIEWER_CHARS ||
    sanitizeForTerminal(who) !== who ||
    /[\r\n]/.test(who)
  ) {
    throw new Error(`--reviewed-by must be a name or handle (1–${MAX_REVIEWER_CHARS} printable characters)`);
  }
  return who;
}

/** The rule as it lands in the source dir: house frontmatter only, plus its sources. */
export function renderPromotedRule(valid: ValidDraft): string {
  const sources = valid.citations.map((c) => `- <${c.url}> — retrieved ${c.retrieved}`).join('\n');
  const body = `${valid.body.trim()}\n\n## Sources\n\n${sources}`;
  return renderFrontmatter(
    { description: valid.description, scope: valid.scope, stacks: valid.stacks },
    body,
  );
}

function renderArchive(
  valid: ValidDraft,
  reviewedBy: string,
  hash: string,
  destination: string,
  now: Date,
): string {
  const draft = {
    ...valid.draft,
    status: 'promoted',
    reviewedBy,
    reviewedAt: now.toISOString(),
    sha256: hash,
    promotedTo: destination,
  };
  // The archive keeps the draft key on purpose: if it is ever copied into a source dir, the
  // marker still withholds it.
  return renderFrontmatter(
    { description: valid.description, scope: valid.scope, stacks: valid.stacks, [DRAFT_KEY]: draft },
    valid.body,
  );
}

function refuse(name: string, errors: DraftIssue[]): never {
  const lines = errors.slice(0, 20).map((e) => `  [${e.code}] ${e.message}`);
  throw new Error(
    [`draft "${name}" cannot be promoted — run \`bluetemberg draft check ${name}\`:`, ...lines].join('\n'),
  );
}

export async function promoteDraft(root: string, name: string, opts: PromoteOptions): Promise<PromoteResult> {
  const reviewedBy = assertReviewer(opts.reviewedBy);
  const now = opts.now ?? new Date();
  const { path, bytes } = readDraftBytes(root, name);
  const hash = sha256(bytes);
  const checked = checkDraftText(bytes.toString('utf8'), name, now);
  if (!checked.valid) refuse(name, checked.errors);
  const valid = checked.valid;

  const closed = gapClosedReason(root, valid.gap);
  if (closed) refuse(name, [{ code: 'gap-closed', message: closed }]);

  const target = promotionTarget(root, name);
  const archive = promotedPath(root, name);
  assertNoSymlinks(root, archive);
  if (existsSync(target))
    throw new Error(`${displayPath(root, target)} already exists — promotion never overwrites`);
  if (existsSync(archive))
    throw new Error(`${displayPath(root, archive)} already exists — remove the old archive first`);

  const output = renderPromotedRule(valid);
  const destination = displayPath(root, target);
  const approved = await opts.confirm({
    name,
    destination,
    output: sanitizeForTerminal(output),
    sha256: hash,
    gap: { stack: sanitizeForTerminal(valid.gap.stack), version: sanitizeForTerminal(valid.gap.version) },
    citations: valid.citations.map((c) => ({
      ...c,
      url: sanitizeForTerminal(c.url),
      quote: sanitizeForTerminal(c.quote),
    })),
    warnings: checked.warnings,
  });
  if (!approved) return { name, promoted: false, destination, archived: null, sha256: hash };

  if (sha256(readDraftBytes(root, name).bytes) !== hash) {
    throw new Error(
      `draft "${name}" changed while it was being reviewed — nothing was written; review it again`,
    );
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output, { flag: 'wx' });
  mkdirSync(promotedDir(root), { recursive: true });
  assertNoSymlinks(root, archive);
  writeFileSync(archive, renderArchive(valid, reviewedBy, hash, destination, now), { flag: 'wx' });
  unlinkSync(path);
  return { name, promoted: true, destination, archived: displayPath(root, archive), sha256: hash };
}
