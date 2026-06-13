import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamProfile } from '../types.js';

const CATALOG_URL = 'https://raw.githubusercontent.com/prototypdigital/bluetemberg-packs/main/catalog.json';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

interface CatalogPack {
  name: string;
  version: string;
  description: string;
  profiles: TeamProfile[];
  universal: boolean;
  kind: 'rules' | 'agents' | 'skills' | 'guardrails';
  rules?: string[];
  agents?: string[];
  skills?: string[];
  guardrails?: string[];
  preview: string;
}

interface Catalog {
  generated: string;
  packs: CatalogPack[];
}

export interface PreviewOptions {
  /** Suppress output (still returns data). */
  silent?: boolean;
  /** Force re-fetch even if cache is fresh. */
  force?: boolean;
  /** Output channel — defaults to no-op when silent, process.stdout otherwise. */
  log?: (msg: string) => void;
}

function getCachePath(root: string): string {
  return join(root, '.bluetemberg', 'catalog.json');
}

async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch catalog: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).packs)) {
    throw new Error('Invalid catalog format: missing or non-array "packs" field');
  }
  const packs = (data as Record<string, unknown>).packs as unknown[];
  for (const pack of packs) {
    if (
      !pack ||
      typeof pack !== 'object' ||
      typeof (pack as Record<string, unknown>).name !== 'string' ||
      typeof (pack as Record<string, unknown>).version !== 'string' ||
      typeof (pack as Record<string, unknown>).kind !== 'string' ||
      !Array.isArray((pack as Record<string, unknown>).profiles)
    ) {
      throw new Error('Invalid catalog format: pack missing required fields (name, version, kind, profiles)');
    }
  }
  return data as Catalog;
}

function loadCachedCatalog(cachePath: string, force: boolean): Catalog | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw) as Catalog;
    if (force) return null;
    const generatedTime = new Date(cached.generated).getTime();
    if (Number.isNaN(generatedTime)) return null;
    const age = Date.now() - generatedTime;
    if (age > CACHE_MAX_AGE_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedCatalog(cachePath: string, catalog: Catalog): void {
  try {
    mkdirSync(join(cachePath, '..'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(catalog, null, 2) + '\n');
  } catch {
    // cache write failure is non-fatal
  }
}

function packsForProfile(catalog: Catalog, profile: TeamProfile): CatalogPack[] {
  return catalog.packs.filter((p) => p.universal || p.profiles.includes(profile));
}

function byKind(packs: CatalogPack[], kind: CatalogPack['kind']): CatalogPack[] {
  return packs.filter((p) => p.kind === kind);
}

function printSection(title: string, packs: CatalogPack[], log: (msg: string) => void): void {
  if (packs.length === 0) return;
  log(`\n${title} (${packs.length})`);
  for (const pack of packs) {
    const shortName = pack.name.replace(/^bluetemberg-(rules|agents|skills|guardrails)-/, '');
    log(`  ${pack.name}  ${pack.version}`);
    log(`    ${pack.description}`);
    if (pack.preview) {
      const preview = pack.preview.slice(0, 300).replace(/\n/g, ' ');
      log(`    └─ "${preview}${pack.preview.length > 300 ? '…' : ''}"`);
    }
    void shortName;
  }
}

export async function preview(
  root: string,
  profile: TeamProfile,
  options: PreviewOptions = {},
): Promise<void> {
  const { silent = false, force = false, log: logFn } = options;
  const log = silent ? () => {} : (logFn ?? ((msg: string) => process.stdout.write(msg + '\n')));

  const cachePath = getCachePath(root);
  let catalog = loadCachedCatalog(cachePath, force);
  const fromCache = catalog !== null;

  if (!catalog) {
    catalog = await fetchCatalog();
    writeCachedCatalog(cachePath, catalog);
  }

  const packs = packsForProfile(catalog, profile);

  if (!silent) {
    const cacheNote = fromCache ? ' (cached)' : '';
    log(`\nProfile: ${profile}${cacheNote}`);
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
    log(`\nRun \`bluetemberg init --profile ${profile}\` to scaffold this configuration.`);
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
