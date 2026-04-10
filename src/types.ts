export type Platform = 'cursor' | 'claude' | 'copilot' | 'gemini';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export type TeamProfile = 'frontend' | 'backend' | 'fullstack' | 'devops' | 'custom';

export interface TargetConfig {
  dir: string;
  ext: string;
}

export interface SkillTargetConfig {
  dir: string;
}

export interface BlueprintConfig {
  platforms: Platform[];
  source: string;
  targets: {
    rules?: Partial<Record<Platform, TargetConfig>>;
    agents?: Partial<Record<Platform, TargetConfig>>;
    skills?: Partial<Record<Platform, SkillTargetConfig>>;
  };
  /**
   * Additional source directories to merge with the local `source` directory.
   * Supports relative paths (e.g. `"../../"` for monorepo root) and npm package names
   * (e.g. `"@company/ai-rules"`). The local `source` directory always takes highest priority;
   * earlier entries in the array take priority over later ones.
   *
   * For relative paths, Bluetemberg looks for a `llm/` subdirectory at that path, then falls
   * back to the path itself. For npm packages, it looks inside `node_modules/{name}/llm/`.
   */
  extends?: string | string[];
  /**
   * Optional ESM module specifiers (npm package names or `file:` URLs) loaded after built-in sync steps.
   * Each module must `export default` as a function or `{ run(ctx, recordError) }` — see wiki *Adapters*.
   */
  adapters?: string[];
}

export interface InitAnswers {
  teamProfile: TeamProfile;
  projectName: string;
  projectDescription: string;
  packageManager: PackageManager;
  platforms: Platform[];
  rules: string[];
  includeAgents: boolean;
  agents: string[];
  includeSkills: boolean;
  skills: string[];
  includeMcp: boolean;
  mcpServers: string[];
}

export interface SyncOptions {
  check?: boolean;
  config?: BlueprintConfig;
  silent?: boolean;
  /**
   * After a successful write pass, delete previously generated files under managed output dirs
   * that are not part of the current plan. Ignored in check mode. See wiki *Commands*.
   */
  prune?: boolean;
  /**
   * Emit additional debug output: resolved source directories, per-file origin when multiple
   * sources are active, and any non-fatal warnings (e.g. unresolved `extends` entries).
   */
  verbose?: boolean;
}

export interface SyncResults {
  synced: number;
  outOfSync: number;
  /** Fatal issues that caused sync to partially fail. Causes exit code 1. */
  errors: string[];
  /** Non-fatal notices — logged but do not affect exit code. */
  warnings: string[];
}

export interface RuleFrontmatter {
  description?: string;
  scope?: string | string[];
}

export interface PresetItem {
  id: string;
  name: string;
  description: string;
  default: boolean;
  tags?: TeamProfile[];
  universal?: boolean;
}

export interface PlatformChoice {
  id: Platform;
  name: string;
}

export interface PackageManagerChoice {
  id: PackageManager;
  name: string;
}

export interface TeamProfileChoice {
  id: TeamProfile;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Registry — community rule packs
// ---------------------------------------------------------------------------

/** Manifest file (`llm/rule-packages.json`) — committed to version control. */
export interface PackageManifest {
  /** Optional custom registry URL. Defaults to `https://registry.npmjs.org`. */
  registry?: string;
  /** Map of package name → semver range (e.g. `"^1.2.0"`). */
  packages: Record<string, string>;
}

/** Single entry in the lockfile. */
export interface PackageLockEntry {
  /** Exact resolved version (e.g. `"1.2.3"`). */
  version: string;
  /** Full tarball URL used to download this version. */
  resolved: string;
  /** Subresource integrity hash (`sha512-…`). */
  integrity: string;
}

/** Lockfile (`llm/rule-packages-lock.json`) — committed to version control. */
export interface PackageLock {
  lockfileVersion: 1;
  packages: Record<string, PackageLockEntry>;
}

/** Metadata returned from the npm registry for a single package. */
export interface NpmPackageMetadata {
  name: string;
  description?: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, NpmVersionMetadata>;
}

/** Metadata for a specific version from the npm registry. */
export interface NpmVersionMetadata {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  dist: {
    tarball: string;
    integrity?: string;
    shasum: string;
  };
}

/** npm search result item. */
export interface NpmSearchResult {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
}

/** Describes a locally installed rule pack. */
export interface InstalledPackage {
  name: string;
  /** Semver range from the manifest. */
  range: string;
  /** Exact installed version from the lockfile. */
  version: string;
  /** Absolute path to the extracted pack content. */
  path: string;
}

/** Options for `registry.add()`. */
export interface RegistryAddOptions {
  /** Semver range (default: `"latest"`). */
  version?: string;
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.install()`. */
export interface RegistryInstallOptions {
  /** Suppress output. */
  silent?: boolean;
  /** Force re-download even if cached. */
  force?: boolean;
}

/** Options for `registry.search()`. */
export interface RegistrySearchOptions {
  /** Max results to return (default: 20). */
  limit?: number;
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.remove()`. */
export interface RegistryRemoveOptions {
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.list()`. */
export interface RegistryListOptions {
  /** Suppress output. */
  silent?: boolean;
}
