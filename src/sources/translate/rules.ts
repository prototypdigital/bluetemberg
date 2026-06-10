import { basename } from 'node:path';
import { mapToNativeRule, parseDoc, stringifyDoc, synthesizeDescription } from './frontmatter.js';

/** A markdown/Cursor/`.cursorrules` rule file (excluding repo READMEs). */
export function isRuleFile(filename: string): boolean {
  const base = basename(filename);
  if (base === 'README.md') return false;
  return base.endsWith('.md') || base.endsWith('.mdc') || base.endsWith('.cursorrules');
}

/**
 * Translate one rule file's content into native bluetemberg format:
 * map foreign frontmatter (`.mdc` globs/alwaysApply) to `{description, scope}`,
 * and synthesize a description when the source has none (e.g. plain `.cursorrules`).
 */
export function translateRuleContent(filename: string, content: string): string {
  const { data, body } = parseDoc(content);
  const native = mapToNativeRule(data);
  const description = native.description || synthesizeDescription(body, filename);
  return stringifyDoc(body, { ...native, description });
}
