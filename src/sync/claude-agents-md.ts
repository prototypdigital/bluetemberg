import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Platform } from '../types.js';
import { readIfExists } from '../utils/fs.js';

// Claude Code reads AGENTS.md on its own only when no CLAUDE.md-family file is on the path; any of
// these at the root suppresses it unless one imports or symlinks AGENTS.md. See Architecture.md
// "Claude Code and AGENTS.md" for the precedence table this check encodes.
const CLAUDE_INSTRUCTION_FILES = ['CLAUDE.md', join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'] as const;

/** Claude Code follows `@path` imports at most four hops deep. */
const MAX_IMPORT_DEPTH = 4;

const FENCED_BLOCK = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const CODE_SPAN = /(`+)[\s\S]*?\1/g;
// An import starts at a line start or after whitespace (so `user@host` is not one) and runs to the
// next unescaped space; `\ ` escapes a space inside the path.
const IMPORT_TOKEN = /(?:^|\s)@((?:\\ |\S)+)/g;

export interface ClaudeAgentsMdContext {
  root: string;
  platforms: readonly Platform[];
}

/** Returns the `@path` imports Claude Code would expand, skipping code spans and fenced blocks. */
export function extractImports(markdown: string): string[] {
  const prose = markdown.replace(FENCED_BLOCK, '').replace(CODE_SPAN, '');
  return [...prose.matchAll(IMPORT_TOKEN)].map((m) => m[1].replace(/\\ /g, ' '));
}

function resolveImport(fromFile: string, importPath: string): string {
  if (importPath.startsWith('~/')) return join(homedir(), importPath.slice(2));
  if (isAbsolute(importPath)) return importPath;
  return resolve(dirname(fromFile), importPath);
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when `file` pulls in `target` through `@path` imports, following up to four hops. */
function importsTarget(file: string, target: string, depth: number, seen: Set<string>): boolean {
  if (depth > MAX_IMPORT_DEPTH || seen.has(file)) return false;
  seen.add(file);

  const content = readIfExists(file);
  if (content === null) return false;

  for (const imported of extractImports(content).map((p) => realpathOrSelf(resolveImport(file, p)))) {
    if (imported === target) return true;
    if (importsTarget(imported, target, depth + 1, seen)) return true;
  }
  return false;
}

/** True when the instruction file loads AGENTS.md for Claude Code, by symlink or by import. */
function reachesAgentsMd(file: string, agentsMd: string): boolean {
  if (lstatSync(file).isSymbolicLink() && realpathOrSelf(file) === agentsMd) return true;
  return importsTarget(realpathOrSelf(file), agentsMd, 1, new Set());
}

/**
 * Warns when a root CLAUDE.md, `.claude/CLAUDE.md`, or CLAUDE.local.md stops Claude Code from reading
 * AGENTS.md: their presence switches off the native AGENTS.md fallback, so unless one of them imports
 * or symlinks it, AGENTS.md never reaches Claude and nothing else says so.
 */
export function checkClaudeAgentsMdImport(
  ctx: ClaudeAgentsMdContext,
  recordWarning: (message: string) => void,
): void {
  if (!ctx.platforms.includes('claude')) return;

  const agentsPath = join(ctx.root, 'AGENTS.md');
  if (!existsSync(agentsPath)) return;

  const present = CLAUDE_INSTRUCTION_FILES.filter((f) => existsSync(join(ctx.root, f)));
  if (present.length === 0) return;

  const agentsMd = realpathOrSelf(agentsPath);
  if (present.some((f) => reachesAgentsMd(join(ctx.root, f), agentsMd))) return;

  const verb = present.length === 1 ? 'exists' : 'exist';
  recordWarning(
    `${present.join(', ')} ${verb} without an \`@AGENTS.md\` import, so Claude Code will not read ` +
      'AGENTS.md (a CLAUDE.md-family file switches off its native AGENTS.md fallback). Add ' +
      '`@AGENTS.md` as the first line of CLAUDE.md, or symlink CLAUDE.md to AGENTS.md.',
  );
}
