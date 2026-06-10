import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { listDirs } from '../../utils/fs.js';
import { safeKey } from '../cache.js';
import type { SourceSubtype } from '../types.js';
import { isRuleFile, translateRuleContent } from './rules.js';
import { isAgentFile, translateAgentContent } from './agents.js';
import { isSkillDir, translateSkillMd } from './skills.js';

export interface TranslateOptions {
  /** When the raw layout is flat (no rules/agents/skills dirs), the category to treat files as. */
  subtypeHint?: SourceSubtype;
}

/**
 * Translate a raw fetched directory into native bluetemberg layout under `destRoot`.
 *
 * Two layouts are recognized:
 *   - **Structured** — `rules/`, `agents/`, and/or `skills/` subdirs are routed by category.
 *   - **Flat** — a bare directory of files is treated as rules (or `subtypeHint`).
 *
 * Nested rule/agent files are flattened into the top-level `rules/`/`agents/` dir
 * (joined with `__`) because sync globs those dirs non-recursively.
 *
 * @returns The number of native items written.
 */
export function translateDir(srcRoot: string, destRoot: string, options: TranslateOptions = {}): number {
  if (!existsSync(srcRoot) || !statSync(srcRoot).isDirectory()) return 0;

  const hasRules = isDir(join(srcRoot, 'rules'));
  const hasAgents = isDir(join(srcRoot, 'agents'));
  const hasSkills = isDir(join(srcRoot, 'skills'));

  if (hasRules || hasAgents || hasSkills) {
    let count = 0;
    if (hasRules) count += emitRules(join(srcRoot, 'rules'), destRoot);
    if (hasAgents) count += emitAgents(join(srcRoot, 'agents'), destRoot);
    if (hasSkills) count += emitSkills(join(srcRoot, 'skills'), destRoot);
    return count;
  }

  const hint = options.subtypeHint ?? 'rule';
  if (hint === 'agent') return emitAgents(srcRoot, destRoot);
  if (hint === 'skill') return emitSkills(srcRoot, destRoot);
  return emitRules(srcRoot, destRoot);
}

function emitRules(srcDir: string, destRoot: string): number {
  let count = 0;
  for (const relPath of walkFiles(srcDir)) {
    if (!isRuleFile(relPath)) continue;
    const content = readFileSync(join(srcDir, relPath), 'utf8');
    writeFile(
      join(destRoot, 'rules', flattenName(relPath)),
      translateRuleContent(basename(relPath), content),
    );
    count++;
  }
  return count;
}

function emitAgents(srcDir: string, destRoot: string): number {
  let count = 0;
  for (const relPath of walkFiles(srcDir)) {
    if (!isAgentFile(relPath)) continue;
    const content = readFileSync(join(srcDir, relPath), 'utf8');
    const outName = flattenName(relPath);
    writeFile(join(destRoot, 'agents', outName), translateAgentContent(stemOf(outName), content));
    count++;
  }
  return count;
}

function emitSkills(srcDir: string, destRoot: string): number {
  let count = 0;
  for (const name of listDirs(srcDir)) {
    const skillSrc = join(srcDir, name);
    if (!isSkillDir(skillSrc)) continue;
    const skillName = safeKey(name);
    for (const relPath of walkFiles(skillSrc)) {
      const content = readFileSync(join(skillSrc, relPath), 'utf8');
      const out = relPath === 'SKILL.md' ? translateSkillMd(skillName, content) : content;
      writeFile(join(destRoot, 'skills', skillName, relPath), out);
    }
    count++;
  }
  return count;
}

/** `python/django.mdc` → `python__django.md`; `nextjs.cursorrules` → `nextjs.md`; `.cursorrules` → `cursorrules.md`. */
function flattenName(relPath: string): string {
  const noExt = relPath.replace(/\.(md|mdc|cursorrules)$/i, '');
  const flat = noExt.split('/').filter(Boolean).join('__');
  return `${flat === '' ? 'cursorrules' : flat}.md`;
}

function stemOf(filename: string): string {
  return basename(filename).replace(/\.[^.]+$/, '');
}

function walkFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkFiles(join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
  return out;
}

function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}
