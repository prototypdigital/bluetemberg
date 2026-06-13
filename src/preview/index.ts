import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamProfile } from '../types.js';

const CATALOG_URL =
  'https://raw.githubusercontent.com/prototypdigital/bluetemberg-packs/main/catalog.json';
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
}

function getCachePath(root: string): string {
  return join(root, '.bluetemberg', 'catalog.json');
}

async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch catalog: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<Catalog>;
}

function loadCachedCatalog(cachePath: string, force: boolean): Catalog | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw) as Catalog;
    if (force) return null;
    const age = Date.now() - new Date(cached.generated).getTime();
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
  return catalog.packs.filter(
    (p) => p.universal || p.profiles.includes(profile),
  );
}

function byKind(packs: CatalogPack[], kind: CatalogPack['kind']): CatalogPack[] {
  return packs.filter((p) => p.kind === kind);
}

function printSection(title: string, packs: CatalogPack[]): void {
  if (packs.length === 0) return;
  console.log(`\n${title} (${packs.length})`);
  for (const pack of packs) {
    const shortName = pack.name.replace(/^bluetemberg-(rules|agents|skills|guardrails)-/, '');
    console.log(`  ${pack.name}  ${pack.version}`);
    console.log(`    ${pack.description}`);
    if (pack.preview) {
      const preview = pack.preview.slice(0, 160).replace(/\n/g, ' ');
      console.log(`    └─ "${preview}${pack.preview.length > 160 ? '…' : ''}"`);
    }
    void shortName;
  }
}

export async function preview(
  root: string,
  profile: TeamProfile,
  options: PreviewOptions = {},
): Promise<void> {
  const { silent = false, force = false } = options;

  const cachePath = getCachePath(root);
  let catalog = loadCachedCatalog(cachePath, force);
  const fromCache = catalog !== null;

  if (!catalog) {
    try {
      catalog = await fetchCatalog();
      writeCachedCatalog(cachePath, catalog);
    } catch (err) {
      if (!silent) {
        console.warn(
          `Warning: could not fetch pack catalog (${err instanceof Error ? err.message : String(err)}). ` +
            `Run with --force to retry.`,
        );
      }
      return;
    }
  }

  const packs = packsForProfile(catalog, profile);

  if (!silent) {
    const cacheNote = fromCache ? ' (cached)' : '';
    console.log(`\nProfile: ${profile}${cacheNote}`);
    console.log('─'.repeat(40));

    printSection('Rules', byKind(packs, 'rules'));
    printSection('Guardrails', byKind(packs, 'guardrails'));
    printSection('Agents', byKind(packs, 'agents'));
    printSection('Skills', byKind(packs, 'skills'));

    const total = packs.length;
    const byKindCount = (['rules', 'agents', 'skills', 'guardrails'] as const)
      .map((k) => `${byKind(packs, k).length} ${k}`)
      .filter((s) => !s.startsWith('0'))
      .join(', ');
    console.log(`\nTotal: ${total} packs (${byKindCount})`);
    console.log(`\nRun \`bluetemberg init --profile ${profile}\` to scaffold this configuration.`);
  }
}

export async function previewList(options: { silent?: boolean } = {}): Promise<void> {
  const { TEAM_PROFILES } = await import('../init/presets.js');
  if (!options.silent) {
    console.log('\nAvailable profiles:');
    for (const p of TEAM_PROFILES) {
      console.log(`  ${p.id.padEnd(16)} ${p.description}`);
    }
    console.log('\nUsage: bluetemberg preview <profile>');
  }
}
