// Endpoints + tunables for the external source adapters. Network bases are kept
// here (not inline) so tests and self-hosted users can reason about / override them.

/** Shared fetch timeout, matching the registry client. */
export const SOURCE_FETCH_TIMEOUT_MS = 30_000;

// --- GitHub ---------------------------------------------------------------

/** REST API base, used to resolve a ref → commit SHA. */
export const GITHUB_API_BASE = 'https://api.github.com';
/** Tarball host. A repo archive lives at `{base}/{owner}/{repo}/tar.gz/{ref}`. */
export const GITHUB_CODELOAD_BASE = 'https://codeload.github.com';

// --- PRPM (registry.prpm.dev) --------------------------------------------

/** PRPM REST API base (verified live). */
export const PRPM_API_BASE = 'https://registry.prpm.dev/api/v1';

// --- cursor.directory (Supabase PostgREST) -------------------------------
//
// cursor.directory exposes no documented REST API; its frontend reads data from
// Supabase using a public *publishable* (anon) key. We replicate that client path
// to read plugin metadata only — the rule-content table is RLS-locked to the anon
// key, so content is fetched from each plugin's GitHub `repository` instead.
//
// These are public client credentials (baked into the site's JS bundle). Override
// via env if the project rotates them; env takes precedence over the defaults below.

/** Public Supabase base URL for cursor.directory (custom domain over knhgkaawjfqqwmsgmxns.supabase.co). */
const CURSOR_DIRECTORY_DEFAULT_URL = 'https://service.cursor.directory';
/** Public publishable key extracted from cursor.directory's client bundle (verified live 2026-06-10). */
const CURSOR_DIRECTORY_DEFAULT_KEY = 'sb_publishable_uMy8fK8O2IS3FANtHWiP6w_FQ9Ojj0J';

/** Resolve cursor.directory's Supabase URL + publishable key from the environment. */
export function cursorDirectoryConfig(): { url: string; key: string } {
  return {
    url: process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL ?? CURSOR_DIRECTORY_DEFAULT_URL,
    key: process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY ?? CURSOR_DIRECTORY_DEFAULT_KEY,
  };
}
