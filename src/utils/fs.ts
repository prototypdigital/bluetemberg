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
 * Entries bluetemberg keeps out of a consumer's git history.
 *
 * `.npmrc` is here because private-registry credentials live there (see
 * `docs/wiki/Registry.md`), and an accidentally committed token is the most expensive
 * mistake this tool can invite. Ignoring it does not untrack an `.npmrc` a project
 * already commits deliberately.
 */
const MANAGED_IGNORES = [
  { comment: '# Bluetemberg cache', entry: '.bluetemberg/' },
  { comment: '# Registry credentials — keep tokens in the environment, not in the repo', entry: '.npmrc' },
] as const;

/**
 * Ensure the entries bluetemberg manages ({@link MANAGED_IGNORES}) are git-ignored.
 *
 * No-op when there is no `.gitignore` (don't create one for a non-git project) or when
 * every entry is already present; each entry is appended independently, so a project
 * ignoring only one of them still gets the other.
 */
export function ensureGitignore(root: string): void {
  const gitignorePath = join(root, '.gitignore');
  if (!existsSync(gitignorePath)) return;

  const content = readFileSync(gitignorePath, 'utf8');
  const missing = MANAGED_IGNORES.filter(({ entry }) => !content.includes(entry));
  if (missing.length === 0) return;

  const added = missing.flatMap(({ comment, entry }) => ['', comment, entry]);
  writeFileSync(gitignorePath, [...content.split('\n'), ...added, ''].join('\n'));
}
