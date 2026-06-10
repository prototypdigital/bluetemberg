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
// Supabase using a public *publishable* (anon) key. We replicate that client path.
// These are placeholders captured from the deployed bundle during the PR3 spike;
// both are overridable by env for self-hosting / key rotation.

export const CURSOR_DIRECTORY_SUPABASE_URL = process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL ?? '';
export const CURSOR_DIRECTORY_PUBLISHABLE_KEY = process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY ?? '';
