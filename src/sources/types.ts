// ---------------------------------------------------------------------------
// External rule sources — pull rules from GitHub repos, PRPM, and cursor.directory
//
// Mirrors the npm rule-pack registry (`src/registry/`) with a "reference + cache"
// model: a manifest declares sources, a lockfile pins them, content is fetched +
// translated into native format under `.bluetemberg/sources/`, and `sync` includes
// the cached dirs automatically (lowest priority).
// ---------------------------------------------------------------------------

/** The external source backends bluetemberg can pull rules from. */
export type SourceType = 'github' | 'prpm' | 'cursor-directory';

export const SOURCE_TYPES: readonly SourceType[] = ['github', 'prpm', 'cursor-directory'];

/** Native item category a translated file maps to. */
export type SourceSubtype = 'rule' | 'agent' | 'skill';

/**
 * A user-declared source, post-parse. Discriminated union keyed by `type`.
 *
 * The *floating* selector (github `ref`, prpm `range`) is part of the spec; the
 * *pinned* identifier lives in the lockfile. The manifest stores this spec verbatim.
 */
export type SourceSpec =
  | { type: 'github'; owner: string; repo: string; ref: string; path: string }
  | { type: 'prpm'; name: string; range: string }
  | { type: 'cursor-directory'; slug: string };

/** Stable identity for a source, used as the manifest/lock/cache key. Excludes floating selectors. */
export type SourceKey = string;

/** Output of `adapter.resolve()`: pins an exact, reproducible version + a content fingerprint. */
export interface ResolvedSource {
  spec: SourceSpec;
  key: SourceKey;
  /**
   * The pinned, immutable ref used for cache addressing and reproducibility:
   * github → commit SHA, prpm → exact version, cursor-directory → content hash.
   */
  ref: string;
  /** Where the raw bytes come from (tarball URL or API URL). Recorded in the lockfile. */
  resolved: string;
  /** sha512 of the tarball (github/prpm) or of the canonical content (cursor-directory). */
  integrity: string;
  /** cursor-directory only: the plugin's repository URL, enabling the github fallback. */
  repository?: string;
}

/**
 * Hand-off from `adapter.fetch()` to the shared translate step. The adapter has
 * populated `rawDir` with files; the pipeline then translates them into the cache.
 */
export interface RawFetchResult {
  /** Absolute path to the dir the adapter populated with raw files. */
  rawDir: string;
  /** Optional sub-path within `rawDir` to treat as the source root (e.g. github `path`). */
  rootSubdir?: string;
  /** Optional category hint when the raw layout does not encode it (e.g. a flat PRPM package). */
  subtypeHint?: SourceSubtype;
  /**
   * Integrity computed while fetching (e.g. tarball sha512), when the adapter
   * couldn't know it at `resolve` time. Overrides {@link ResolvedSource.integrity}.
   */
  integrity?: string;
}

/** Per-call network options shared by adapters. */
export interface SourceNetOptions {
  /** cursor-directory: override the publishable key (falls back to constants/env). */
  apiKey?: string;
  /** github: optional token to lift rate limits / read private repos. */
  token?: string;
}

/** A discovery result from `adapter.search()`. */
export interface SourceSearchResult {
  type: SourceType;
  /** An installable spec string, e.g. `prpm:@scope/name`. */
  spec: string;
  name: string;
  description?: string;
  subtype?: SourceSubtype;
}

/**
 * A source backend. Adapters do only two network things — `resolve` (pin a version)
 * and `fetch` (populate a temp dir). Everything after `fetch` is shared, so the
 * pipeline never branches on `type`.
 */
export interface SourceAdapter {
  readonly type: SourceType;
  /** Resolve a floating spec to a pinned, integrity-bearing {@link ResolvedSource}. */
  resolve(spec: SourceSpec, options?: SourceNetOptions): Promise<ResolvedSource>;
  /** Populate `tmpDir` with raw files (download+extract a tarball, or write files directly). */
  fetch(resolved: ResolvedSource, tmpDir: string, options?: SourceNetOptions): Promise<RawFetchResult>;
  /** Optional catalog search. Not every backend supports it (github does not). */
  search?(query: string, options?: SourceNetOptions): Promise<SourceSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Manifest (llm/rule-sources.json) + lockfile (llm/rule-sources-lock.json)
// ---------------------------------------------------------------------------

/** Manifest — declared sources keyed by {@link SourceKey}; value is the floating {@link SourceSpec}. */
export interface SourceManifest {
  sources: Record<SourceKey, SourceSpec>;
}

/** One pinned source in the lockfile. */
export interface SourceLockEntry {
  type: SourceType;
  /** Pinned identifier: github commit SHA | prpm exact version | cursor-directory content hash. */
  ref: string;
  /** Tarball URL or API URL the bytes came from. */
  resolved: string;
  /** sha512 of tarball (github/prpm) or canonical content (cursor-directory). */
  integrity: string;
  /** cursor-directory only: the plugin's repository URL (for the github fallback). */
  repository?: string;
}

/** Lockfile — pinned sources keyed by {@link SourceKey}. */
export interface SourceLock {
  lockfileVersion: 1;
  sources: Record<SourceKey, SourceLockEntry>;
}

/** Describes a locally installed external source. */
export interface InstalledSource {
  key: SourceKey;
  type: SourceType;
  /** Pinned ref from the lockfile, or `'not installed'`. */
  ref: string;
  /** Absolute path to the translated cache content, or `''` when uncached. */
  path: string;
}

// ---------------------------------------------------------------------------
// Command options (parallel to the registry's Registry*Options)
// ---------------------------------------------------------------------------

export interface SourceAddOptions {
  silent?: boolean;
}
export interface SourceRemoveOptions {
  silent?: boolean;
}
export interface SourceListOptions {
  silent?: boolean;
}
export interface SourceInstallOptions {
  silent?: boolean;
  /** Force re-download even if cached. */
  force?: boolean;
}
export interface SourceUpdateOptions {
  silent?: boolean;
}
export interface SourceSearchOptions {
  /** Restrict the search to one backend (github does not support search). */
  type?: SourceType;
  /** Max results (default 20). */
  limit?: number;
  silent?: boolean;
}
