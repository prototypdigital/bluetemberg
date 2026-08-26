export { sync, loadConfig, shouldExitWithFailure } from './sync/index.js';
export { init } from './init/index.js';
export { scaffold } from './init/scaffold.js';
export { switchProfile } from './init/switch-profile.js';
export type { SwitchProfileOptions, SwitchProfileResult } from './init/switch-profile.js';
export { transformFrontmatter, DEFAULT_TARGETS } from './sync/transform.js';
export {
  add as registryAdd,
  remove as registryRemove,
  list as registryList,
  install as registryInstall,
  update as registryUpdate,
  search as registrySearch,
  resolvePackSourceDirs,
} from './registry/index.js';
export {
  addSource,
  removeSource,
  listSources,
  installSources,
  updateSources,
  searchSources,
  resolveExternalSourceDirs,
} from './sources/registry.js';
export { parseSourceSpec, sourceKey } from './sources/spec.js';
export type {
  SourceType,
  SourceSpec,
  SourceManifest,
  SourceLock,
  SourceLockEntry,
  InstalledSource,
  SourceSearchResult,
  SourceAdapter,
} from './sources/types.js';
export type {
  Platform,
  TeamProfile,
  BlueprintConfig,
  InitAnswers,
  InitRunOptions,
  SyncOptions,
  SyncResults,
  RuleFrontmatter,
  PresetItem,
  PackageManifest,
  PackageLock,
  PackageLockEntry,
  InstalledPackage,
  NpmSearchResult,
  RegistryAddOptions,
  RegistryInstallOptions,
  RegistryUpdateOptions,
} from './types.js';
export type { AdapterContext, AdapterRecordError, AdapterRunFn } from './sync/adapter-contract.js';
