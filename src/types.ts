export type Platform = 'cursor' | 'claude' | 'copilot';

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
