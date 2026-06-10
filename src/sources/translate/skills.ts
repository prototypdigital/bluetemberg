import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseDoc, stringifyDoc } from './frontmatter.js';

/** A skill is a directory containing a `SKILL.md` entry file. */
export function isSkillDir(dirPath: string): boolean {
  return existsSync(join(dirPath, 'SKILL.md'));
}

/**
 * Normalize a skill's `SKILL.md`: guarantee `name` (defaulting to the skill's
 * directory name). Non-`SKILL.md` assets in the skill dir are copied verbatim.
 */
export function translateSkillMd(skillName: string, content: string): string {
  const { data, body } = parseDoc(content);
  if (typeof data.name === 'string' && data.name.trim() !== '') {
    return content;
  }
  return stringifyDoc(body, { name: skillName, ...data });
}
