export { sync, loadConfig, shouldExitWithFailure } from './sync/index.js';
export { init } from './init/index.js';
export { transformFrontmatter, DEFAULT_TARGETS } from './sync/transform.js';
export {
  add as registryAdd,
  remove as registryRemove,
  list as registryList,
  install as registryInstall,
  search as registrySearch,
  resolvePackSourceDirs,
} from './registry/index.js';
export type {
  Platform,
  BlueprintConfig,
  InitAnswers,
  SyncOptions,
  SyncResults,
  RuleFrontmatter,
  PresetItem,
  PackageManifest,
  PackageLock,
  PackageLockEntry,
  InstalledPackage,
  NpmSearchResult,
} from './types.js';
export type { AdapterContext, AdapterRecordError, AdapterRunFn } from './sync/adapter-contract.js';
