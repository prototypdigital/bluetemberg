import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildGapBrief } from '../src/drafts/brief.js';
import { checkDraft, checkDraftText } from '../src/drafts/check.js';
import { createDraft, listDrafts } from '../src/drafts/draft.js';
import { parseStrictFrontmatter } from '../src/drafts/frontmatter.js';
import { parseDraftKind } from '../src/drafts/kinds.js';
import { promoteDraft, type PromotionReview } from '../src/drafts/promote.js';
import { callStacksTool } from '../src/mcp/server.js';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const QUOTE = 'Jobs are stored in the payload-jobs collection.';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-kinds-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const CONFIG: BlueprintConfig = {
  platforms: ['claude'],
  source: 'llm',
  targets: {},
  stacks: { payload: '4.0.1' },
};

function writeConfig(root: string): void {
  writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(CONFIG));
}

const DRAFT_BLOCK = (kind: string): string => `draft:
  status: draft-unvetted
  kind: ${kind}
  gap:
    stack: payload
    version: 4.0.1
    reason: no-coverage
    confidence: declared
  reviewedBy: null
  citations:
    - url: https://payloadcms.com/docs/jobs-queue/overview
      quote: "${QUOTE}"
      retrieved: 2026-11-03`;

function skillText(
  frontmatter = 'name: payload-4-jobs\ndescription: Queue a Payload job safely. Use when adding background work.',
): string {
  return `---
${frontmatter}
stacks:
  payload: ">=4 <5"
${DRAFT_BLOCK('skill')}
---

# payload-4-jobs

Use this skill when adding background work to a Payload 4 app.

## Protocol

### Step 1 — Queue through the jobs collection

Call \`payload.jobs.queue\`.
`;
}

function agentText(tools = '[read, search]', extra = ''): string {
  return `---
name: payload-4-jobs
description: Reviews Payload 4 job code. Use after changes to background work.
tools: ${tools}
${extra}stacks:
  payload: ">=4 <5"
${DRAFT_BLOCK('agent')}
---

# Payload jobs reviewer

You are a Payload 4 jobs reviewer.

## Constraints

- Never edit files.
`;
}

function writeDraft(root: string, text: string, name = 'payload-4-jobs'): void {
  mkdirSync(join(root, '.bluetemberg', 'drafts'), { recursive: true });
  writeFileSync(join(root, '.bluetemberg', 'drafts', `${name}.md`), text);
}

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);

async function promote(root: string, onReview?: (r: PromotionReview) => void): Promise<void> {
  await promoteDraft(root, 'payload-4-jobs', {
    reviewedBy: 'jr',
    now: NOW,
    env: {},
    verifyCitations: false,
    confirm: async (review) => {
      onReview?.(review);
      return true;
    },
  });
}

describe('parseDraftKind', () => {
  it('defaults to rule and refuses anything else', () => {
    expect(parseDraftKind(undefined)).toBe('rule');
    expect(parseDraftKind('agent')).toBe('agent');
    expect(() => parseDraftKind('command')).toThrow(/rule, skill, agent/);
  });
});

describe('draft new --kind', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeConfig(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('opens a skill skeleton named after the draft, with no scope', () => {
    createDraft(root, 'payload', '4.0.1', { name: 'payload-4-jobs', kind: 'skill', now: NOW });
    const { data, body } = parseStrictFrontmatter(
      readFileSync(join(root, '.bluetemberg', 'drafts', 'payload-4-jobs.md'), 'utf8'),
    );
    expect(Object.keys(data)).toEqual(['name', 'description', 'stacks', 'draft']);
    expect(data.name).toBe('payload-4-jobs');
    expect(body).toContain('## Protocol');
    expect(listDrafts(root)[0]).toMatchObject({ kind: 'skill', status: 'pending' });
    expect(codes(checkDraft(root, 'payload-4-jobs', NOW).errors)).toContain('todo');
  });

  it('opens an agent skeleton that starts read-only', () => {
    createDraft(root, 'payload', '4.0.1', { name: 'payload-4-jobs', kind: 'agent', now: NOW });
    const { data } = parseStrictFrontmatter(
      readFileSync(join(root, '.bluetemberg', 'drafts', 'payload-4-jobs.md'), 'utf8'),
    );
    expect(data.tools).toEqual(['read', 'search']);
  });

  it('refuses --scope for a skill, and a name taken by an existing skill dir', () => {
    expect(() =>
      createDraft(root, 'payload', '4.0.1', { name: 'x-skill', kind: 'skill', scope: '**' }),
    ).toThrow(/rules only/);
    mkdirSync(join(root, 'llm', 'skills', 'taken'), { recursive: true });
    expect(() => createDraft(root, 'payload', '4.0.1', { name: 'taken', kind: 'skill' })).toThrow(
      /skill named "taken" already exists/,
    );
  });

  it('names the matching authoring skill in the brief', () => {
    expect(buildGapBrief(root, 'payload', '4.0.1', 'skill').authoring).toMatchObject({
      kind: 'skill',
      skill: 'create-skill',
    });
    expect(buildGapBrief(root, 'payload', '4.0.1', 'agent').authoring.skill).toBe('create-agent');
  });
});

describe('check by kind', () => {
  it('passes a complete skill and a read-only agent', () => {
    expect(checkDraftText(skillText(), 'payload-4-jobs', NOW).errors).toEqual([]);
    const agent = checkDraftText(agentText(), 'payload-4-jobs', NOW);
    expect(agent.errors).toEqual([]);
    expect(agent.warnings).toEqual([]);
    expect(agent.valid?.frontmatter).toMatchObject({ name: 'payload-4-jobs', tools: ['read', 'search'] });
  });

  it('requires name to match the draft name', () => {
    const text = skillText('name: something-else\ndescription: d is long enough here.');
    expect(codes(checkDraftText(text, 'payload-4-jobs', NOW).errors)).toContain('name-mismatch');
  });

  it('holds each kind to its own keys', () => {
    const skillWithScope = skillText(
      'name: payload-4-jobs\ndescription: Queue a Payload job safely.\nscope: "**"',
    );
    expect(codes(checkDraftText(skillWithScope, 'payload-4-jobs', NOW).errors)).toContain('unknown-key');
    const agentWithModel = agentText('[read]', 'model: opus\n');
    expect(codes(checkDraftText(agentWithModel, 'payload-4-jobs', NOW).errors)).toContain('unknown-key');
  });

  it('refuses an unknown kind', () => {
    const text = skillText().replace('kind: skill', 'kind: command');
    expect(codes(checkDraftText(text, 'payload-4-jobs', NOW).errors)).toContain('draft-kind');
  });

  it.each([
    ['missing tools', agentText('[]'), 'tools-missing'],
    ['a host tool name', agentText('[read, Bash]'), 'tools-unknown'],
    ['a wildcard', agentText('["*"]'), 'tools-unknown'],
    ['an MCP tool', agentText('[read, mcp__github__create_pr]'), 'tools-unknown'],
  ])('refuses an agent with %s', (_label, text, code) => {
    expect(codes(checkDraftText(text, 'payload-4-jobs', NOW).errors)).toContain(code);
  });

  it('refuses an agent with no tools key at all (it would inherit every tool)', () => {
    const text = agentText().replace(/^tools: .*\n/m, '');
    expect(codes(checkDraftText(text, 'payload-4-jobs', NOW).errors)).toContain('tools-missing');
  });

  it('warns when an agent can write, run or spawn', () => {
    const result = checkDraftText(agentText('[read, edit, execute]'), 'payload-4-jobs', NOW);
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toContain('tools-write-access');
  });
});

describe('promote by kind', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeConfig(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes a skill as llm/skills/<name>/SKILL.md, and sync emits it', async () => {
    writeDraft(root, skillText());
    let seen: PromotionReview | null = null;
    await promote(root, (r) => (seen = r));
    expect(seen!.kind).toBe('skill');
    const file = join(root, 'llm', 'skills', 'payload-4-jobs', 'SKILL.md');
    const { data, body } = parseStrictFrontmatter(readFileSync(file, 'utf8'));
    expect(Object.keys(data)).toEqual(['name', 'description', 'stacks']);
    expect(body).toContain('## Sources');

    await sync(root, { config: CONFIG, silent: true });
    expect(existsSync(join(root, '.claude', 'skills', 'payload-4-jobs', 'SKILL.md'))).toBe(true);
  });

  it('writes an agent with its tools shown to the reviewer, and sync emits it', async () => {
    writeDraft(root, agentText('[read, edit]'));
    let seen: PromotionReview | null = null;
    await promote(root, (r) => (seen = r));
    expect(seen!.tools).toEqual(['read', 'edit']);
    expect(seen!.warnings.map((w) => w.code)).toContain('tools-write-access');
    const { data } = parseStrictFrontmatter(
      readFileSync(join(root, 'llm', 'agents', 'payload-4-jobs.md'), 'utf8'),
    );
    expect(data.tools).toEqual(['read', 'edit']);

    await sync(root, { config: CONFIG, silent: true });
    expect(existsSync(join(root, '.claude', 'agents', 'payload-4-jobs.md'))).toBe(true);
  });

  it('never writes into an existing skill dir, even an empty one', async () => {
    writeDraft(root, skillText());
    mkdirSync(join(root, 'llm', 'skills', 'payload-4-jobs'), { recursive: true });
    const confirm = vi.fn(async () => true);
    await expect(
      promoteDraft(root, 'payload-4-jobs', {
        reviewedBy: 'jr',
        confirm,
        now: NOW,
        env: {},
        verifyCitations: false,
      }),
    ).rejects.toThrow(/already exists/);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('MCP draft_brief kind', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeConfig(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('takes a kind and refuses an unknown one', async () => {
    const brief = (await callStacksTool(root, 'bluetemberg_draft_brief', {
      stack: 'payload',
      version: '4.0.1',
      kind: 'agent',
    })) as { authoring: { skill: string } };
    expect(brief.authoring.skill).toBe('create-agent');
    await expect(
      callStacksTool(root, 'bluetemberg_draft_brief', { stack: 'payload', version: '4.0.1', kind: 'hook' }),
    ).rejects.toThrow(/--kind/);
  });
});
