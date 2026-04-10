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
}

export interface SyncResults {
  synced: number;
  outOfSync: number;
  errors: string[];
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
