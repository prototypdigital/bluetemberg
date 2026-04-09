export { sync, loadConfig, shouldExitWithFailure } from './sync/index.js';
export { init } from './init/index.js';
export { transformFrontmatter, DEFAULT_TARGETS } from './sync/transform.js';
export type {
  Platform,
  BlueprintConfig,
  InitAnswers,
  SyncOptions,
  SyncResults,
  RuleFrontmatter,
  PresetItem,
} from './types.js';
export type { AdapterContext, AdapterRecordError, AdapterRunFn } from './sync/adapter-contract.js';
