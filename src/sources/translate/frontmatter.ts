import matter from 'gray-matter';
import type { RuleFrontmatter } from '../../types.js';

export interface ParsedDoc {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parse a markdown document's frontmatter + body, resiliently.
 *
 * Community .mdc / .cursorrules files frequently contain YAML-hostile frontmatter —
 * e.g. an unquoted glob whose leading star is read as a YAML alias. Cursor tolerates
 * it; strict gray-matter does not. So we: parse strictly, then on failure repair the
 * obvious offenders and re-parse, then on failure fall back to body-only. A single
 * malformed file must never abort a sync.
 */
export function parseDoc(content: string): ParsedDoc {
  try {
    const parsed = matter(content);
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch {
    try {
      const parsed = matter(repairFrontmatter(content));
      return { data: parsed.data as Record<string, unknown>, body: parsed.content };
    } catch {
      return { data: {}, body: stripFrontmatter(content) };
    }
  }
}

/** Quote unquoted YAML scalar values that begin with an indicator char or contain a glob star. */
function repairFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return content;
  const [, frontmatter, body] = match;
  const repaired = frontmatter.split('\n').map(repairLine).join('\n');
  return `---\n${repaired}\n---\n${body}`;
}

function repairLine(line: string): string {
  const keyValue = line.match(/^(\s*[A-Za-z0-9_-]+:\s+)(\S.*?)\s*$/);
  if (keyValue) return keyValue[1] + quoteIfNeeded(keyValue[2]);

  const listItem = line.match(/^(\s*-\s+)(\S.*?)\s*$/);
  if (listItem) return listItem[1] + quoteIfNeeded(listItem[2]);

  return line;
}

// Leading chars that make an unquoted YAML scalar invalid/ambiguous (alias, anchor,
// tag, block scalars, directives) and show up in real-world .mdc glob values.
const YAML_INDICATOR_CHARS = '*&!|>@%';

function quoteIfNeeded(value: string): string {
  if (/^["'[{]/.test(value)) return value; // already quoted or a flow collection
  if (YAML_INDICATOR_CHARS.includes(value[0]) || value.includes('*')) {
    // JSON double-quoting is valid YAML double-quoting for these scalar values.
    return JSON.stringify(value);
  }
  return value;
}

/** Drop a leading `--- ... ---` frontmatter block, returning the body. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : content;
}

/** Serialize body + frontmatter back to a markdown string. */
export function stringifyDoc(body: string, data: Record<string, unknown>): string {
  return matter.stringify(body, data);
}

/**
 * Map any foreign rule frontmatter to bluetemberg's native {@link RuleFrontmatter}.
 *
 * Handles Cursor `.mdc` (`{description, globs, alwaysApply}`) and already-native
 * (`{description, scope}`) shapes:
 *   - `alwaysApply: true`            → `scope: '**'`
 *   - `globs: ...`                   → `scope: <globs>`
 *   - native `scope`                 → passthrough
 *   - otherwise                      → `scope: '**'` (transformFrontmatter's default)
 */
export function mapToNativeRule(data: Record<string, unknown>): RuleFrontmatter {
  const description = typeof data.description === 'string' ? data.description : '';

  if (data.alwaysApply === true) {
    return { description, scope: '**' };
  }

  const globs = normalizeGlobs(data.globs);
  if (globs !== undefined) {
    return { description, scope: globs };
  }

  if (typeof data.scope === 'string' || Array.isArray(data.scope)) {
    return { description, scope: data.scope as string | string[] };
  }

  return { description, scope: '**' };
}

/** Normalize a `globs` value (string | string[]) into a scope, or undefined when absent/empty. */
function normalizeGlobs(globs: unknown): string | string[] | undefined {
  if (typeof globs === 'string') {
    return globs.trim() === '' ? undefined : globs;
  }
  if (Array.isArray(globs)) {
    const strings = globs.filter((g): g is string => typeof g === 'string' && g.trim() !== '');
    if (strings.length === 0) return undefined;
    return strings.length === 1 ? strings[0] : strings;
  }
  return undefined;
}

/**
 * Derive a description for a rule that has none: the first markdown heading text,
 * else a humanized form of the filename.
 */
export function synthesizeDescription(body: string, filename: string): string {
  for (const line of body.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) return heading[1].trim();
  }
  return humanizeFilename(filename);
}

/** `nextjs-app-router.cursorrules` → "Nextjs app router". */
export function humanizeFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (base === '') return 'Rule';
  return base.charAt(0).toUpperCase() + base.slice(1);
}
