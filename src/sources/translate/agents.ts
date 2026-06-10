import { basename } from 'node:path';
import { parseDoc, stringifyDoc } from './frontmatter.js';

/** A markdown agent definition (excluding READMEs). Agents are `.md` with `{name, description, tools?}`. */
export function isAgentFile(filename: string): boolean {
  const base = basename(filename);
  if (base === 'README.md') return false;
  return base.endsWith('.md');
}

/**
 * Normalize an agent file. Agents are copied verbatim by sync, so this only
 * guarantees a `name` (defaulting to the file stem) — otherwise the content is
 * left byte-identical to avoid needless reformatting of already-native agents.
 */
export function translateAgentContent(stem: string, content: string): string {
  const { data, body } = parseDoc(content);
  if (typeof data.name === 'string' && data.name.trim() !== '') {
    return content;
  }
  return stringifyDoc(body, { name: stem, ...data });
}
