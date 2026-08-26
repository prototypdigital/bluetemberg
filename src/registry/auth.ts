import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Registry credential resolution.
 *
 * Mirrors npm's own model so an existing CI setup works unchanged: credentials are
 * declared per *host+path prefix* (npm calls these "nerf darts") in `.npmrc`, and the
 * most specific matching scope wins.
 *
 *   //npm.pkg.github.com/:_authToken=ghp_xxx
 *   //artifactory.acme.com/api/npm/npm-local/:_authToken=${NPM_TOKEN}
 *
 * Precedence, highest first:
 *   1. `<cwd>/.npmrc`
 *   2. `$NPM_CONFIG_USERCONFIG` or `~/.npmrc`
 *   3. `NPM_TOKEN` / `NODE_AUTH_TOKEN` from the environment
 *
 * The env fallback (3) is host-agnostic and is therefore only ever applied to the
 * registry the project's manifest configures — never to a tarball CDN on a different
 * host, and never to an external rule source. Projects that talk to more than one
 * registry should use host-scoped `.npmrc` entries instead of a bare env token.
 *
 * Credentials are read from the environment and `.npmrc` only. They are never read
 * from, or written to, project config, the lockfile, or any log line.
 *
 * The project `.npmrc` is looked up relative to `process.cwd()`, matching npm. The CLI
 * always runs with cwd at the project root, so the two coincide; a programmatic caller
 * that passes a `root` other than its cwd should put credentials in the user `.npmrc` or
 * the environment instead.
 */

/** npm config key suffixes that carry a credential. */
const AUTH_TOKEN_KEY = '_authToken';
const AUTH_BASIC_KEY = '_auth';
const USERNAME_KEY = 'username';
const PASSWORD_KEY = '_password';

/** Env vars checked as a last resort. `NODE_AUTH_TOKEN` is what `actions/setup-node` sets. */
const TOKEN_ENV_VARS = ['NPM_TOKEN', 'NODE_AUTH_TOKEN'] as const;

/**
 * Parsed `.npmrc` entries, merged across files with the most local file winning. Keyed by
 * the files that produced them, so a process that resolves credentials for more than one
 * project (or after a `chdir`) never reuses another project's config.
 */
const configCache = new Map<string, Map<string, string>>();

/**
 * Resolve an `Authorization` header value for a registry URL, or `undefined` when no
 * credential is configured.
 */
export function registryAuthHeader(registryUrl: string): string | undefined {
  const scopes = registryScopes(registryUrl);
  // No identifiable host means no credential: we cannot tell who would receive it.
  if (scopes.length === 0) return undefined;

  const config = npmrcConfig();
  for (const scope of scopes) {
    const header = scopeAuthHeader(config, scope);
    if (header) return header;
  }

  return envAuthHeader();
}

/**
 * Header object for a registry request — empty when no credential applies, so it can
 * be spread unconditionally into a `fetch` headers literal.
 */
export function registryAuthHeaders(registryUrl: string): Record<string, string> {
  const header = registryAuthHeader(registryUrl);
  return header ? { Authorization: header } : {};
}

/**
 * Strip `user:password@` userinfo from a URL so it is safe to log, throw, or record in
 * the lockfile. Some self-hosted registries are configured with inline credentials;
 * those must never outlive the request.
 */
export function redactCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    // Not a parseable URL — nothing to redact, and callers only use this for output.
    return url;
  }
}

/** Clear the parsed `.npmrc` cache (for testing only). */
export function clearRegistryAuthCache(): void {
  configCache.clear();
}

// ---------------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------------

/**
 * npm-style scope keys for a registry URL, most specific first. A registry at
 * `https://acme.com/api/npm/local` yields `//acme.com/api/npm/local/`,
 * `//acme.com/api/npm/`, `//acme.com/api/`, `//acme.com/`.
 */
function registryScopes(registryUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(registryUrl);
  } catch {
    return [];
  }

  const host = parsed.host;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const scopes: string[] = [];

  for (let i = segments.length; i > 0; i--) {
    scopes.push(`//${host}/${segments.slice(0, i).join('/')}/`);
  }
  scopes.push(`//${host}/`);

  return scopes;
}

/** Build an `Authorization` value from whichever credential style the scope declares. */
function scopeAuthHeader(config: Map<string, string>, scope: string): string | undefined {
  const token = expandEnv(config.get(`${scope}:${AUTH_TOKEN_KEY}`));
  if (token) return `Bearer ${token}`;

  const basic = expandEnv(config.get(`${scope}:${AUTH_BASIC_KEY}`));
  if (basic) return `Basic ${basic}`;

  const username = expandEnv(config.get(`${scope}:${USERNAME_KEY}`));
  const password = expandEnv(config.get(`${scope}:${PASSWORD_KEY}`));
  if (!username || !password) return undefined;

  // npm stores `_password` base64-encoded; the header needs base64(user:plaintext).
  const plaintext = Buffer.from(password, 'base64').toString('utf8');
  return `Basic ${Buffer.from(`${username}:${plaintext}`).toString('base64')}`;
}

function envAuthHeader(): string | undefined {
  for (const name of TOKEN_ENV_VARS) {
    const value = process.env[name]?.trim();
    if (value) return `Bearer ${value}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// .npmrc parsing
// ---------------------------------------------------------------------------

function npmrcConfig(): Map<string, string> {
  const userConfig = process.env.NPM_CONFIG_USERCONFIG || join(homedir(), '.npmrc');
  const projectConfig = join(process.cwd(), '.npmrc');

  const cacheKey = `${userConfig}\u0000${projectConfig}`;
  const cached = configCache.get(cacheKey);
  if (cached) return cached;

  // Least specific first so the project file overwrites the user file.
  const merged = new Map<string, string>();
  for (const file of [userConfig, projectConfig]) {
    for (const [key, value] of parseNpmrc(file)) {
      merged.set(key, value);
    }
  }

  configCache.set(cacheKey, merged);
  return merged;
}

/** Read `key=value` pairs from an `.npmrc`. Missing or unreadable files yield nothing. */
function parseNpmrc(filePath: string): Map<string, string> {
  const entries = new Map<string, string>();
  if (!existsSync(filePath)) return entries;

  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    // Unreadable (permissions, a directory) — treat as absent rather than failing install.
    return entries;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    const value = unquote(line.slice(eq + 1).trim());
    if (key) entries.set(key, value);
  }

  return entries;
}

function unquote(value: string): string {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0];
    if (value.endsWith(quote)) return value.slice(1, -1);
  }
  return value;
}

/**
 * Expand `${VAR}` references the way npm does. An unset variable yields `undefined`
 * rather than a literal `${VAR}`, so a misconfigured CI never sends a placeholder as a
 * credential.
 */
function expandEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;

  let unresolved = false;
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const env = process.env[name];
    if (env === undefined || env === '') {
      unresolved = true;
      return '';
    }
    return env;
  });

  if (unresolved) return undefined;
  return expanded.trim() || undefined;
}
