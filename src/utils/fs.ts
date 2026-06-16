import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Result of comparing planned content against the on-disk file without writing. */
export interface CheckResult {
  /** True when the file is missing or differs from the planned content (after newline normalization). */
  outOfSync: boolean;
  /** Normalized on-disk content, or `null` when the file does not exist yet. */
  existing: string | null;
  /** Normalized planned content. */
  content: string;
}

/**
 * Compare planned `content` against the on-disk file without writing, returning both normalized
 * sides so callers (e.g. `sync --check --diff`) can render the difference. Newlines are normalized
 * on both sides, so CRLF/LF-only changes are not reported as drift — matching {@link writeOrCheck}.
 */
export function computeCheck(filePath: string, content: string): CheckResult {
  const normalizedContent = normalizeNewlines(content);
  const existing = existsSync(filePath) ? normalizeNewlines(readFileSync(filePath, 'utf8')) : null;
  if (existing === null) {
    return { outOfSync: true, existing: null, content: normalizedContent };
  }
  return { outOfSync: existing !== normalizedContent, existing, content: normalizedContent };
}

export function writeOrCheck(filePath: string, content: string, checkMode = false): boolean {
  if (checkMode) return computeCheck(filePath, content).outOfSync;
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content);
  return false;
}

export function readIfExists(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

export function listFiles(dir: string, filter: (f: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(filter);
}

export function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/**
 * Ensure `.bluetemberg/` (the pack + external-source cache) is git-ignored.
 *
 * No-op when there is no `.gitignore` (don't create one for a non-git project)
 * or when the marker is already present.
 */
export function ensureGitignore(root: string): void {
  const gitignorePath = join(root, '.gitignore');
  const marker = '.bluetemberg/';

  if (!existsSync(gitignorePath)) return;

  const content = readFileSync(gitignorePath, 'utf8');
  if (content.includes(marker)) return;

  const lines = content.split('\n');
  const newContent = [...lines, '', '# Bluetemberg cache', marker, ''].join('\n');
  writeFileSync(gitignorePath, newContent);
}
