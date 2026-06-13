import type { SourceSpec, SourceKey } from './types.js';

/**
 * Parse a user-supplied source spec string into a normalized {@link SourceSpec}.
 *
 * Grammars:
 *   github:<owner>/<repo>[#<ref>][:<path>]   e.g. github:PatrickJS/awesome-cursorrules#HEAD:rules
 *   prpm:<name>[@<range>]                    e.g. prpm:@obra/skill-x@^1.0.0  (default range "latest")
 *   cursor-directory:<slug>                  slug, or "*" for every active plugin
 *
 * @throws If the prefix is unknown or the body is malformed.
 */
export function parseSourceSpec(raw: string): SourceSpec {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf(':');
  if (sep === -1) {
    throw new Error(`Invalid source spec "${raw}": expected "<type>:<...>" (e.g. "github:owner/repo:rules")`);
  }

  const type = trimmed.slice(0, sep);
  const body = trimmed.slice(sep + 1);

  if (type === 'github') return parseGithub(body, raw);
  if (type === 'prpm') return parsePrpm(body, raw);
  if (type === 'cursor-directory') return parseCursorDirectory(body, raw);

  throw new Error(
    `Invalid source spec "${raw}": unknown type "${type}" (expected github, prpm, or cursor-directory)`,
  );
}

/** Derive the stable manifest/lock/cache key for a spec. Excludes floating selectors (ref/range). */
export function sourceKey(spec: SourceSpec): SourceKey {
  if (spec.type === 'github') {
    return spec.path ? `github:${spec.owner}/${spec.repo}:${spec.path}` : `github:${spec.owner}/${spec.repo}`;
  }
  if (spec.type === 'prpm') return `prpm:${spec.name}`;
  return `cursor-directory:${spec.slug}`;
}

const NAME_SEGMENT = /^[A-Za-z0-9._-]+$/;
/** PRPM package name: an npm-style segment, optionally scoped (`@scope/name`). */
const PRPM_NAME = /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;

function parseGithub(body: string, raw: string): SourceSpec {
  // Split off `:path` first (the first colon after owner/repo[#ref]), then `#ref`.
  const colon = body.indexOf(':');
  const beforePath = colon === -1 ? body : body.slice(0, colon);
  const path = colon === -1 ? '' : body.slice(colon + 1);

  const hash = beforePath.indexOf('#');
  const ownerRepo = hash === -1 ? beforePath : beforePath.slice(0, hash);
  const ref = hash === -1 ? 'HEAD' : beforePath.slice(hash + 1);

  const slash = ownerRepo.indexOf('/');
  if (slash === -1) {
    throw new Error(`Invalid github source "${raw}": expected "github:owner/repo[#ref][:path]"`);
  }
  const owner = ownerRepo.slice(0, slash);
  const repo = ownerRepo.slice(slash + 1);

  if (!NAME_SEGMENT.test(owner) || !NAME_SEGMENT.test(repo)) {
    throw new Error(`Invalid github source "${raw}": owner and repo must match [A-Za-z0-9._-]`);
  }
  if (ref === '') {
    throw new Error(`Invalid github source "${raw}": ref cannot be empty when "#" is present`);
  }
  assertNoTraversal(path, raw);

  return { type: 'github', owner, repo, ref, path: normalizePath(path) };
}

function parsePrpm(body: string, raw: string): SourceSpec {
  const { name, range } = splitNameRange(body);
  if (name === '') {
    throw new Error(`Invalid prpm source "${raw}": expected "prpm:name[@range]"`);
  }
  if (!PRPM_NAME.test(name)) {
    throw new Error(
      `Invalid prpm source "${raw}": name must be a package name like "name" or "@scope/name" ([A-Za-z0-9._-])`,
    );
  }
  return { type: 'prpm', name, range };
}

function parseCursorDirectory(body: string, raw: string): SourceSpec {
  const slug = body.trim();
  if (slug === '') {
    throw new Error(
      `Invalid cursor-directory source "${raw}": expected "cursor-directory:slug" or "cursor-directory:*"`,
    );
  }
  if (slug !== '*' && !NAME_SEGMENT.test(slug)) {
    throw new Error(`Invalid cursor-directory source "${raw}": slug must be "*" or match [A-Za-z0-9._-]`);
  }
  return { type: 'cursor-directory', slug };
}

/** Split `name[@range]`, handling scoped names (`@scope/name@range`). Defaults range to "latest". */
function splitNameRange(spec: string): { name: string; range: string } {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/');
    if (slash === -1) return { name: spec, range: 'latest' };
    const at = spec.indexOf('@', slash);
    if (at === -1) return { name: spec, range: 'latest' };
    return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' };
  }
  const at = spec.indexOf('@');
  if (at === -1) return { name: spec, range: 'latest' };
  return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' };
}

function normalizePath(path: string): string {
  // Trim leading/trailing slashes without a regex. The previous
  // `/\/+$/` form triggered a polynomial-ReDoS warning (CodeQL js/polynomial-redos);
  // this O(n) scan is behaviour-identical and preserves internal slashes.
  let start = 0;
  let end = path.length;
  while (start < end && path[start] === '/') start += 1;
  while (end > start && path[end - 1] === '/') end -= 1;
  return path.slice(start, end);
}

function assertNoTraversal(path: string, raw: string): void {
  if (path.split('/').some((seg) => seg === '..')) {
    throw new Error(`Invalid source spec "${raw}": path must not contain ".." segments`);
  }
}
