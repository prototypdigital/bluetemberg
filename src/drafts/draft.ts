import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sanitizeForTerminal } from '../registry/scanner.js';
import { loadConfig } from '../sync/index.js';
import { buildGapBrief, type GapBrief } from './brief.js';
import { DRAFT_STATUS_UNVETTED, MAX_DRAFT_BYTES, TODO_MARKER } from './check.js';
import { parseStrictFrontmatter, renderFrontmatter } from './frontmatter.js';
import { DRAFT_KEY } from './marker.js';
import {
  assertDraftName,
  assertNoSymlinks,
  displayPath,
  draftPath,
  draftsDir,
  promotedDir,
  promotedPath,
} from './paths.js';

/** `bluetemberg draft new` / `draft list` — open a draft for a gap, and list drafts. */

export interface NewDraftOptions {
  name: string;
  scope?: string;
  /** Recorded in the provenance block, e.g. `bluetemberg@0.4.0`. */
  engine?: string;
  now?: Date;
}

export interface NewDraftResult {
  name: string;
  path: string;
  brief: GapBrief;
}

/**
 * The rule file promotion would write for `name`. It must sit inside the project with no symlink
 * on the way: a symlinked `llm/rules` would land the write somewhere the reviewer never saw, while
 * the review shows the innocent-looking relative path.
 */
export function promotionTarget(root: string, name: string): string {
  assertDraftName(name);
  const target = join(resolve(root), loadConfig(root).source, 'rules', `${name}.md`);
  assertNoSymlinks(root, target);
  return target;
}

function skeleton(brief: GapBrief, opts: NewDraftOptions, now: Date): string {
  const { stack, version, kind, confidence, source } = brief.gap;
  const data = {
    description: `${TODO_MARKER}: one imperative sentence stating the rule`,
    scope: opts.scope ?? '**',
    stacks: { [stack]: brief.proposedRange },
    [DRAFT_KEY]: {
      status: DRAFT_STATUS_UNVETTED,
      kind: 'rule',
      gap: { stack, version, reason: kind, confidence, source },
      createdAt: now.toISOString(),
      engine: opts.engine ?? 'bluetemberg',
      reviewedBy: null,
      citations: [],
    },
  };
  const body = [
    `# ${TODO_MARKER}: rule title`,
    '',
    `${TODO_MARKER}: why — the consequence this rule prevents in ${stack} ${brief.proposedRange}.`,
    '',
    '## Rules',
    '',
    `- ${TODO_MARKER}: a concrete, checkable directive, paired with its positive replacement.`,
    '',
    '## Examples',
    '',
    `${TODO_MARKER}: a BAD / GOOD code pair grounded in the cited documentation.`,
    '',
    '## Gotchas',
    '',
    `- ${TODO_MARKER}: edge cases at the ${stack} version boundary, or delete this section.`,
  ].join('\n');
  return renderFrontmatter(data, body);
}

/**
 * Open a draft for `stack@version`. Refuses when the gap is not real (version-correct guidance
 * exists), when the name is taken by a rule or a draft, or when any path segment is a symlink.
 * Writes exactly one file, in the drafts dir, with exclusive create.
 */
export function createDraft(
  root: string,
  stack: string,
  version: string,
  opts: NewDraftOptions,
): NewDraftResult {
  assertDraftName(opts.name);
  if (opts.scope !== undefined && (opts.scope.trim() === '' || /[\r\n]/.test(opts.scope))) {
    throw new Error('--scope must be a single-line glob');
  }
  const brief = buildGapBrief(root, stack, version);
  if (!brief.fillable) throw new Error(brief.refusal ?? 'not a gap');

  const target = promotionTarget(root, opts.name);
  if (existsSync(target)) {
    throw new Error(
      `a rule named "${opts.name}" already exists (${displayPath(root, target)}) — pick another name`,
    );
  }
  const path = draftPath(root, opts.name);
  assertNoSymlinks(root, path);
  if (existsSync(promotedPath(root, opts.name))) {
    throw new Error(`"${opts.name}" was already promoted — pick another name`);
  }
  mkdirSync(draftsDir(root), { recursive: true });
  assertNoSymlinks(root, path);
  try {
    writeFileSync(path, skeleton(brief, opts, opts.now ?? new Date()), { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`a draft named "${opts.name}" already exists — edit it, or pick another name`);
    }
    throw err;
  }
  return { name: opts.name, path: displayPath(root, path), brief };
}

export interface DraftListEntry {
  name: string;
  status: 'pending' | 'promoted' | 'unreadable';
  path: string;
  gap: { stack: string; version: string } | null;
  citations: number;
  reviewedBy: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarise(root: string, dir: string, file: string, status: 'pending' | 'promoted'): DraftListEntry {
  const name = file.slice(0, -'.md'.length);
  const path = join(dir, file);
  const entry: DraftListEntry = {
    name,
    status,
    path: displayPath(root, path),
    gap: null,
    citations: 0,
    reviewedBy: null,
  };
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_DRAFT_BYTES) return { ...entry, status: 'unreadable' };
    const draft = parseStrictFrontmatter(readFileSync(path, 'utf8')).data[DRAFT_KEY];
    if (!isPlainObject(draft)) return { ...entry, status: 'unreadable' };
    const gap = isPlainObject(draft.gap) ? draft.gap : {};
    return {
      ...entry,
      gap:
        typeof gap.stack === 'string' && typeof gap.version === 'string'
          ? { stack: sanitizeForTerminal(gap.stack), version: sanitizeForTerminal(gap.version) }
          : null,
      citations: Array.isArray(draft.citations) ? draft.citations.length : 0,
      reviewedBy: typeof draft.reviewedBy === 'string' ? sanitizeForTerminal(draft.reviewedBy) : null,
    };
  } catch {
    return { ...entry, status: 'unreadable' };
  }
}

function listDir(root: string, dir: string, status: 'pending' | 'promoted'): DraftListEntry[] {
  assertNoSymlinks(root, dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .filter((file) => /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file))
    .sort()
    .map((file) => summarise(root, dir, file, status));
}

/** `bluetemberg draft list` — pending drafts, then promoted ones. Read-only. */
export function listDrafts(root: string): DraftListEntry[] {
  return [...listDir(root, draftsDir(root), 'pending'), ...listDir(root, promotedDir(root), 'promoted')];
}
