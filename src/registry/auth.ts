import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_REGISTRY } from './constants.js';

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
 *   1. `<root>/.npmrc`
 *   2. `$NPM_CONFIG_USERCONFIG` or `~/.npmrc`
 *   3. `NPM_TOKEN` / `NODE_AUTH_TOKEN` from the environment
 *
 * Credentials are read from the environment and `.npmrc` only. They are never read
 * from, or written to, project config, the lockfile, or any log line.
 *
 * Two rules decide whether a resolved credential is actually transmitted; see
 * {@link resolveCredential}. Both exist because the registry URL comes from
 * `llm/packages.json`, which is committed — a cloned repository must not be able to
 * choose where the developer's token goes.
 */

/** npm config key suffixes that carry a credential. */
const AUTH_TOKEN_KEY = '_authToken';
const AUTH_BASIC_KEY = '_auth';
const USERNAME_KEY = 'username';
const PASSWORD_KEY = '_password';

/** Env vars checked as a last resort. `NODE_AUTH_TOKEN` is what `actions/setup-node` sets. */
const TOKEN_ENV_VARS = ['NPM_TOKEN', 'NODE_AUTH_TOKEN'] as const;

/** Opt-in to sending credentials over plaintext HTTP to a non-loopback host. */
const INSECURE_AUTH_ENV = 'BLUETEMBERG_ALLOW_INSECURE_REGISTRY_AUTH';

/** Hosts where cleartext costs nothing because the request never leaves the machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Parsed `.npmrc` entries, merged across files with the most local file winning. Keyed by
 * the files that produced them, so a process that resolves credentials for more than one
 * project (or after a `chdir`) never reuses another project's config.
 */
const configCache = new Map<string, Map<string, string>>();

/** Why a credential is, or is not, being sent to a registry. */
type CredentialOutcome =
  /** No credential is configured for this registry at all. */
  | { kind: 'none' }
  /** A credential applies and is being sent. */
  | { kind: 'send'; header: string }
  /** A credential applies but the transport would leak it. */
  | { kind: 'insecure-transport' }
  /** A bare env token exists but this registry is not one the user pointed it at. */
  | { kind: 'unscoped-env-token' };

/**
 * Resolve an `Authorization` header value for a registry URL, or `undefined` when no
 * credential is configured — or when one is configured but must not be transmitted.
 *
 * @param root - Project root whose `.npmrc` is consulted. Defaults to `process.cwd()`.
 */
export function registryAuthHeader(registryUrl: string, root?: string): string | undefined {
  const outcome = resolveCredential(registryUrl, root);
  return outcome.kind === 'send' ? outcome.header : undefined;
}

/**
 * Header object for a registry request — empty when no credential applies, so it can
 * be spread unconditionally into a `fetch` headers literal.
 */
export function registryAuthHeaders(registryUrl: string, root?: string): Record<string, string> {
  const header = registryAuthHeader(registryUrl, root);
  return header ? { Authorization: header } : {};
}

/**
 * How to configure credentials for a registry, given what is already present. Appended
 * to 401/403 errors: a credential that was found but deliberately withheld is otherwise
 * indistinguishable from one that was never configured.
 */
export function registryCredentialAdvice(registryUrl: string, root?: string): string {
  const target = redactCredentials(registryUrl);
  const outcome = resolveCredential(registryUrl, root);

  if (outcome.kind === 'insecure-transport') {
    return (
      `A credential is configured for ${target} but was not sent: the registry is plain http, ` +
      `so the token would travel in cleartext. Serve the registry over https, or set ` +
      `${INSECURE_AUTH_ENV}=1 to send it anyway.`
    );
  }

  if (outcome.kind === 'unscoped-env-token') {
    return (
      `${TOKEN_ENV_VARS.join('/')} is set but carries no host, and ${target} is not the registry ` +
      `it was pointed at — it was not sent. Scope it explicitly with ` +
      `"${scopeFor(registryUrl)}:_authToken=\${NPM_TOKEN}" in .npmrc, or set NPM_CONFIG_REGISTRY ` +
      `to this registry.`
    );
  }

  if (outcome.kind === 'send') {
    return `A credential was sent for ${target} but the registry rejected it — check that it is valid and not expired.`;
  }

  return `Configure credentials for ${target} via .npmrc ("${scopeFor(registryUrl)}:_authToken=...") or NPM_TOKEN.`;
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
// Resolution
// ---------------------------------------------------------------------------

function resolveCredential(registryUrl: string, root?: string): CredentialOutcome {
  let parsed: URL;
  try {
    parsed = new URL(registryUrl);
  } catch {
    // No identifiable host means no credential: we cannot tell who would receive it.
    return { kind: 'none' };
  }

  const scoped = scopedAuthHeader(parsed, root);
  const env = envAuthHeader();

  // A host-scoped `.npmrc` entry names its recipient, so it needs no further check
  // beyond the transport. A bare env token names none, so the registry has to be one
  // the *user* pointed at — the built-in default, or `$NPM_CONFIG_REGISTRY`. Without
  // this, a committed `llm/packages.json` could redirect the token to any host.
  if (!scoped && env && !envTokenApplies(parsed)) return { kind: 'unscoped-env-token' };

  const header = scoped ?? env;
  if (!header) return { kind: 'none' };

  if (!transportAllowsCredentials(parsed)) return { kind: 'insecure-transport' };

  return { kind: 'send', header };
}

function envTokenApplies(registry: URL): boolean {
  if (sameHost(registry, DEFAULT_REGISTRY)) return true;

  const configured = process.env.NPM_CONFIG_REGISTRY?.trim();
  return !!configured && sameHost(registry, configured);
}

function sameHost(registry: URL, other: string): boolean {
  try {
    return new URL(other).host === registry.host;
  } catch {
    return false;
  }
}

/**
 * Whether a URL's transport may carry a credential: https always; plain http only to
 * loopback (the request never leaves the machine) or with the explicit
 * `BLUETEMBERG_ALLOW_INSECURE_REGISTRY_AUTH=1` opt-in. Applied to the registry URL when
 * resolving, and re-checked by the installer against the tarball URL itself — the
 * registry chooses that URL, and its metadata must not be able to downgrade the
 * transport a credential travels over.
 */
export function transportAllowsCredentials(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (LOOPBACK_HOSTS.has(url.hostname)) return true;
  return process.env[INSECURE_AUTH_ENV] === '1';
}

// ---------------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------------

function scopedAuthHeader(registry: URL, root?: string): string | undefined {
  const config = npmrcConfig(root);
  for (const scope of registryScopes(registry)) {
    const header = scopeAuthHeader(config, scope);
    if (header) return header;
  }
  return undefined;
}

/**
 * npm-style scope keys for a registry URL, most specific first. A registry at
 * `https://acme.com/api/npm/local` yields `//acme.com/api/npm/local/`,
 * `//acme.com/api/npm/`, `//acme.com/api/`, `//acme.com/`.
 */
function registryScopes(registry: URL): string[] {
  const segments = registry.pathname.split('/').filter(Boolean);
  const scopes: string[] = [];

  for (let i = segments.length; i > 0; i--) {
    scopes.push(`//${registry.host}/${segments.slice(0, i).join('/')}/`);
  }
  scopes.push(`//${registry.host}/`);

  return scopes;
}

/** The most specific scope key for a registry URL, for use in guidance messages. */
function scopeFor(registryUrl: string): string {
  try {
    return registryScopes(new URL(registryUrl))[0];
  } catch {
    return '//host/';
  }
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

  const plaintext = decodeNpmPassword(password);
  return `Basic ${Buffer.from(`${username}:${plaintext}`).toString('base64')}`;
}

/**
 * npm stores `_password` base64-encoded, but hand-written and tool-generated `.npmrc`
 * files sometimes hold it in plaintext. Decoding unconditionally would turn such a
 * password into mojibake and produce a 401 with no hint as to why, so only decode when
 * the value round-trips as base64.
 */
function decodeNpmPassword(value: string): string {
  const decoded = Buffer.from(value, 'base64');
  const canonical = decoded.toString('base64').replace(/=+$/, '');
  return canonical === value.replace(/=+$/, '') ? decoded.toString('utf8') : value;
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

function npmrcConfig(root?: string): Map<string, string> {
  const userConfig = process.env.NPM_CONFIG_USERCONFIG || join(homedir(), '.npmrc');
  const projectConfig = join(root ?? process.cwd(), '.npmrc');

  // NUL-separated so two different path pairs cannot join into the same key.
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
