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

const CACHE_IGNORE = { comment: '# Bluetemberg cache', entry: '.bluetemberg/' };
const NPMRC_IGNORE = {
  comment: '# Registry credentials — keep tokens in the environment, not in the repo',
  entry: '.npmrc',
};

/** npm config key suffixes that mark an `.npmrc` line as credential-bearing. */
const NPMRC_CREDENTIAL_KEY = /(^|:)_(authToken|auth|password)\s*=/m;

/**
 * Whether the project `.npmrc` declares a credential (see `docs/wiki/Registry.md`).
 * A `${VAR}` reference counts: it holds no secret itself, but the file is where one
 * would land the day someone pastes a literal token in place of the reference.
 */
function npmrcHoldsCredential(root: string): boolean {
  const npmrcPath = join(root, '.npmrc');
  if (!existsSync(npmrcPath)) return false;
  try {
    return NPMRC_CREDENTIAL_KEY.test(readFileSync(npmrcPath, 'utf8'));
  } catch {
    return false;
  }
}

/** Whether the `.gitignore` content already carries `entry` as its own line (optionally root-anchored). */
function hasIgnoreEntry(content: string, entry: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === entry || trimmed === `/${entry}`;
  });
}

/**
 * Ensure the entries bluetemberg manages are git-ignored.
 *
 * `.bluetemberg/` (the pack + external-source cache) is always managed. `.npmrc` is
 * ignored only once the project's `.npmrc` actually holds a credential key
 * (`_authToken` / `_auth` / `_password`): an accidentally committed token is the most
 * expensive mistake this tool can invite, but a tokenless `.npmrc` (`registry=`, scope
 * mappings) is a file many projects commit deliberately, and blanket-ignoring it would
 * silently hide those. Ignoring never untracks an `.npmrc` that is already committed.
 *
 * No-op when there is no `.gitignore` (don't create one for a non-git project) or when
 * every applicable entry is already present; each entry is appended independently, so a
 * project ignoring only one of them still gets the other.
 */
export function ensureGitignore(root: string): void {
  const gitignorePath = join(root, '.gitignore');
  if (!existsSync(gitignorePath)) return;

  const managed = npmrcHoldsCredential(root) ? [CACHE_IGNORE, NPMRC_IGNORE] : [CACHE_IGNORE];
  const content = readFileSync(gitignorePath, 'utf8');
  const missing = managed.filter(({ entry }) => !hasIgnoreEntry(content, entry));
  if (missing.length === 0) return;

  const added = missing.flatMap(({ comment, entry }) => ['', comment, entry]);
  writeFileSync(gitignorePath, [...content.split('\n'), ...added, ''].join('\n'));
}
