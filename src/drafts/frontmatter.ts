import { parse, stringify } from 'yaml';

/**
 * A strict frontmatter reader for drafts. Drafts are model output — untrusted data — so they are
 * never handed to a general-purpose front-matter library. Only a plain `---` fence of YAML is
 * accepted (a language tag after the fence is refused), YAML aliases are refused (no expansion
 * bombs), duplicate keys are refused, and the result must be a plain mapping.
 */

export interface ParsedDraft {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = '---';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `text` into frontmatter + body. Throws with a short reason when it is not a strict draft. */
export function parseStrictFrontmatter(text: string): ParsedDraft {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== FENCE) {
    throw new Error('frontmatter must start with a line containing exactly "---" (YAML only)');
  }
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) throw new Error('frontmatter is not closed by a "---" line');

  let data: unknown;
  try {
    data = parse(lines.slice(1, close).join('\n'), { maxAliasCount: 0, uniqueKeys: true });
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new Error(`frontmatter is not valid YAML: ${message}`);
  }
  if (!isPlainObject(data)) throw new Error('frontmatter must be a YAML mapping');
  return { data, body: lines.slice(close + 1).join('\n') };
}

/** Render frontmatter + body in the house format (`---` fence, YAML, blank line, body). */
export function renderFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = stringify(data, { lineWidth: 0 }).trimEnd();
  return `${FENCE}\n${yaml}\n${FENCE}\n\n${body.trim()}\n`;
}
