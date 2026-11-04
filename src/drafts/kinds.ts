import { join } from 'node:path';

/**
 * The kinds of content the create-loop can draft (M7, #197). A gap is a `(stack, version)` with
 * no covering guidance; a rule, a skill or an agent can fill it, since all three take `stacks:`.
 * Each kind has its own house format — the frontmatter keys it may carry, the section its body
 * should have, and where a promoted draft lands — and its own `create-*` authoring skill.
 */

export const DRAFT_KINDS = ['rule', 'skill', 'agent'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * The abstract tool names an agent may declare (sync maps them to each host's own tools). A draft
 * may only use these: a host-specific name, a wildcard or an MCP tool would grant capability the
 * reviewer cannot read off the list.
 */
export const AGENT_TOOLS = ['read', 'search', 'edit', 'execute', 'agent'] as const;
/** Tools that let an agent change files, run commands or spawn other agents. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['edit', 'execute', 'agent']);

export interface KindSpec {
  kind: DraftKind;
  /** Frontmatter keys the promoted file carries, in output order (the `draft` block is extra). */
  keys: readonly string[];
  /** The `create-*` skill that defines the kind's house structure. */
  authoringSkill: string;
  /** Body size cap. Rules are always-on context, so theirs is the tightest. */
  maxBodyBytes: number;
  /** A heading the house structure expects; missing it is a warning. */
  expectedSection: { pattern: RegExp; label: string };
}

export const KIND_SPECS: Record<DraftKind, KindSpec> = {
  rule: {
    kind: 'rule',
    keys: ['description', 'scope', 'stacks'],
    authoringSkill: 'create-rule',
    maxBodyBytes: 16 * 1024,
    expectedSection: { pattern: /^##\s+Rules\b/m, label: '## Rules' },
  },
  skill: {
    kind: 'skill',
    keys: ['name', 'description', 'stacks'],
    authoringSkill: 'create-skill',
    maxBodyBytes: 32 * 1024,
    expectedSection: { pattern: /^##\s+Protocol\b/m, label: '## Protocol' },
  },
  agent: {
    kind: 'agent',
    keys: ['name', 'description', 'tools', 'stacks'],
    authoringSkill: 'create-agent',
    maxBodyBytes: 32 * 1024,
    expectedSection: { pattern: /^##\s+Constraints\b/m, label: '## Constraints' },
  },
};

export function isDraftKind(value: unknown): value is DraftKind {
  return typeof value === 'string' && (DRAFT_KINDS as readonly string[]).includes(value);
}

/** Parse a `--kind` value; throws on anything but rule, skill or agent. */
export function parseDraftKind(value: unknown): DraftKind {
  if (value === undefined) return 'rule';
  if (isDraftKind(value)) return value;
  throw new Error(`--kind must be one of ${DRAFT_KINDS.join(', ')}`);
}

/**
 * Where a promoted draft of `kind` lands under the source dir. A skill is a directory; `dir` is
 * the path that must not exist yet (the whole skill, not just its `SKILL.md`).
 */
export function kindTarget(
  sourceDir: string,
  kind: DraftKind,
  name: string,
): { file: string; dir: string | null } {
  if (kind === 'skill') {
    const dir = join(sourceDir, 'skills', name);
    return { file: join(dir, 'SKILL.md'), dir };
  }
  return { file: join(sourceDir, kind === 'rule' ? 'rules' : 'agents', `${name}.md`), dir: null };
}
