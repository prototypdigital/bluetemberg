#!/usr/bin/env node
/**
 * Guard: assert every curated overlay in src/init/presets.ts references a packageName
 * that exists in the committed catalog snapshot, and that agent/skill overlay ids appear
 * in their pack's content array. Exits non-zero on any mismatch.
 *
 * Requires a prior build (imports from dist/init/presets.js).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const catalog = JSON.parse(readFileSync(join(root, 'src', 'catalog', 'catalog.json'), 'utf8'));
if (!catalog || !Array.isArray(catalog.packs)) {
  console.error('Invalid catalog format: missing "packs" array in src/catalog/catalog.json');
  process.exit(1);
}
const packByName = new Map(catalog.packs.map((p) => [p.name, p]));

let RULE_COLLECTION_OVERLAYS, AGENT_OVERLAYS, SKILL_OVERLAYS;
try {
  ({ RULE_COLLECTION_OVERLAYS, AGENT_OVERLAYS, SKILL_OVERLAYS } = await import('../dist/init/presets.js'));
} catch {
  console.error('Failed to import dist/init/presets.js — run "npm run build" first.');
  process.exit(1);
}

const errors = [];

for (const overlay of RULE_COLLECTION_OVERLAYS) {
  if (!packByName.has(overlay.packageName)) {
    errors.push(`RULE_COLLECTION_OVERLAYS "${overlay.id}": unknown packageName "${overlay.packageName}"`);
  }
}

for (const overlay of AGENT_OVERLAYS) {
  const pack = packByName.get(overlay.packageName);
  if (!pack) {
    errors.push(`AGENT_OVERLAYS "${overlay.id}": unknown packageName "${overlay.packageName}"`);
    continue;
  }
  if (!(pack.agents ?? []).includes(overlay.id)) {
    errors.push(
      `AGENT_OVERLAYS: id "${overlay.id}" not found in ${overlay.packageName}.agents[] — catalog has [${(pack.agents ?? []).join(', ')}]`,
    );
  }
}

for (const overlay of SKILL_OVERLAYS) {
  const pack = packByName.get(overlay.packageName);
  if (!pack) {
    errors.push(`SKILL_OVERLAYS "${overlay.id}": unknown packageName "${overlay.packageName}"`);
    continue;
  }
  if (!(pack.skills ?? []).includes(overlay.id)) {
    errors.push(
      `SKILL_OVERLAYS: id "${overlay.id}" not found in ${overlay.packageName}.skills[] — catalog has [${(pack.skills ?? []).join(', ')}]`,
    );
  }
}

if (errors.length > 0) {
  console.error('Overlay validation failed:');
  for (const err of errors) console.error(`  ✗ ${err}`);
  process.exit(1);
}

console.log(
  `✓ All overlays valid — ${RULE_COLLECTION_OVERLAYS.length} rule collections, ${AGENT_OVERLAYS.length} agents, ${SKILL_OVERLAYS.length} skills`,
);
