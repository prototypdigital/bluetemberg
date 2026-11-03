import { AGENT_PLUGINS_PLATFORM, MARKETPLACE_PLATFORM, PLUGIN_BUNDLE_PLATFORMS } from '../types.js';
import type { BlueprintConfig, Platform, TeamProfile } from '../types.js';
import { planPluginFormats, pluginDefinitionsFor } from '../sync/marketplace.js';
import { type Catalog, type CatalogPack, loadCatalog } from '../catalog/index.js';
import { allowsAnyPlatform } from '../catalog/platforms.js';
import { detectStacks } from '../stacks/detect.js';
import { buildStackPackages } from '../stacks/packages.js';
import { hasSyncConfig, loadConfig } from '../sync/index.js';
import { configuredPlatforms, normalizePlatforms } from '../sync/targets.js';
import { DEFAULT_INIT_PLATFORMS } from '../init/init-answers-from-profile.js';

export interface PreviewOptions {
  /** Suppress output (still returns data). */
  silent?: boolean;
  /** Force re-fetch even if cache is fresh. */
  force?: boolean;
  /**
   * Platforms to preview for (`--platforms`). Defaults to the project's configured platforms, or —
   * with no config — the platforms `init` checks by default.
   */
  platforms?: Platform[];
  /** Output channel — defaults to no-op when silent, process.stdout otherwise. */
  log?: (msg: string) => void;
}

function packsForProfile(catalog: Catalog, profile: TeamProfile): CatalogPack[] {
  return catalog.packs.filter((p) => p.universal || p.profiles.includes(profile));
}

/** Whether `init` would preselect a profile pack here: stack-agnostic, or one of its stacks is in the project. */
function matchesProjectStacks(pack: CatalogPack, projectStacks: ReadonlySet<string>): boolean {
  const stacks = pack.stacks ?? [];
  return stacks.length === 0 || stacks.some((s) => projectStacks.has(s));
}

/**
 * The platforms preselection is decided for: `--platforms`, else the project's config (what sync
 * emits for), else init's defaults. An unreadable config falls back to the defaults.
 */
function previewPlatforms(root: string, explicit: Platform[] | undefined): Platform[] {
  if (explicit && explicit.length > 0) return normalizePlatforms(explicit);
  if (!hasSyncConfig(root, false)) return [...DEFAULT_INIT_PLATFORMS];
  try {
    return configuredPlatforms(loadConfig(root));
  } catch {
    return [...DEFAULT_INIT_PLATFORMS];
  }
}

function sameSet(a: readonly Platform[], b: readonly Platform[]): boolean {
  return a.length === b.length && a.every((p) => b.includes(p));
}

function byKind(packs: CatalogPack[], kind: CatalogPack['kind']): CatalogPack[] {
  return packs.filter((p) => p.kind === kind);
}

function printSection(title: string, packs: CatalogPack[], log: (msg: string) => void): void {
  if (packs.length === 0) return;
  log(`\n${title} (${packs.length})`);
  for (const pack of packs) {
    log(`  ${pack.name}  ${pack.version}`);
    log(`    ${pack.description}`);
    if (pack.preview) {
      const preview = pack.preview.slice(0, 300).replace(/\n/g, ' ');
      log(`    └─ "${preview}${pack.preview.length > 300 ? '…' : ''}"`);
    }
  }
}

/**
 * In a project that publishes plugin bundles, the bundles a profile's content lands in: those with
 * no `profiles` (everything) and those that list it.
 */
function printBundles(root: string, profile: TeamProfile, log: (msg: string) => void): void {
  if (!hasSyncConfig(root, false)) return;
  let config: BlueprintConfig;
  try {
    config = loadConfig(root);
  } catch {
    return;
  }
  const formats = PLUGIN_BUNDLE_PLATFORMS.filter((p) => config.platforms.includes(p));
  if (formats.length === 0) return;
  const enabled = {
    claude: config.platforms.includes(MARKETPLACE_PLATFORM),
    agentPlugins: config.platforms.includes(AGENT_PLUGINS_PLATFORM),
  };
  // Same per-plugin decision as sync, so a bundle sync rejects isn't listed.
  const bundles = pluginDefinitionsFor(config, root).filter((p) => {
    const planned = planPluginFormats(p, enabled).formats;
    if (!planned.claude && !planned.agentPlugins) return false;
    return !p.profiles || p.profiles.length === 0 || p.profiles.includes(profile);
  });
  if (bundles.length === 0) return;
  log(`\nPlugin bundles (${formats.join(', ')}):`);
  for (const bundle of bundles) log(`  plugins/${bundle.name}/`);
}

export async function preview(
  root: string,
  profile: TeamProfile,
  options: PreviewOptions = {},
): Promise<void> {
  const { silent = false, force = false, log: logFn } = options;
  const log = silent ? () => {} : (logFn ?? ((msg: string) => process.stdout.write(msg + '\n')));

  const { catalog, fromCache } = await loadCatalog(root, force);

  // Detect with the catalog preview routes with: it may be freshly fetched and not yet cached.
  const projectStacks = new Set(detectStacks(root, undefined, buildStackPackages(catalog).packages).keys());
  const platforms = previewPlatforms(root, options.platforms);
  const profilePacks = packsForProfile(catalog, profile);
  const stackSkipped = profilePacks.filter((p) => !matchesProjectStacks(p, projectStacks));
  // Same predicate as init preselection and sync: a pack none of whose platforms is targeted.
  const platformSkipped = profilePacks.filter(
    (p) => matchesProjectStacks(p, projectStacks) && !allowsAnyPlatform(p.platforms, platforms),
  );
  const packs = profilePacks.filter((p) => !stackSkipped.includes(p) && !platformSkipped.includes(p));

  if (!silent) {
    const cacheNote = fromCache ? ' (cached)' : '';
    log(`\nProfile: ${profile}${cacheNote}`);
    log(`Platforms: ${platforms.join(', ')}`);
    log('─'.repeat(40));

    printSection('Rules', byKind(packs, 'rules'), log);
    printSection('Guardrails', byKind(packs, 'guardrails'), log);
    printSection('Agents', byKind(packs, 'agents'), log);
    printSection('Skills', byKind(packs, 'skills'), log);

    const total = packs.length;
    const byKindCount = (['rules', 'agents', 'skills', 'guardrails'] as const)
      .map((k) => `${byKind(packs, k).length} ${k}`)
      .filter((s) => !s.startsWith('0'))
      .join(', ');
    log(`\nTotal: ${total} packs (${byKindCount})`);
    if (stackSkipped.length > 0) {
      log(`\nNot preselected here (their stack isn't in this project; still offered in the wizard):`);
      for (const pack of stackSkipped) log(`  ${pack.name}  [${(pack.stacks ?? []).join(', ')}]`);
    }
    if (platformSkipped.length > 0) {
      log(
        `\nNot preselected for these platforms (sync would write nothing for them; still offered in the wizard):`,
      );
      for (const pack of platformSkipped) log(`  ${pack.name}  [${(pack.platforms ?? []).join(', ')}]`);
    }
    printBundles(root, profile, log);
    const platformsFlag = sameSet(platforms, DEFAULT_INIT_PLATFORMS)
      ? ''
      : ` --platforms ${platforms.join(',')}`;
    log(
      `\nRun \`bluetemberg init --non-interactive --profile ${profile}${platformsFlag}\` to scaffold this configuration.`,
    );
  }
}

export async function previewList(
  options: { silent?: boolean; log?: (msg: string) => void } = {},
): Promise<void> {
  const { TEAM_PROFILES } = await import('../init/presets.js');
  if (!options.silent) {
    const log = options.log ?? ((msg: string) => process.stdout.write(msg + '\n'));
    log('\nAvailable profiles:');
    for (const p of TEAM_PROFILES) {
      log(`  ${p.id.padEnd(16)} ${p.description}`);
    }
    log('\nUsage: bluetemberg preview <profile>');
  }
}
