// Copy non-TS runtime assets into dist/ after `tsc` (which does not emit data files).
// Keeps the committed catalog snapshot available to the published CLI.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'catalog', 'catalog.json');
const destDir = join(root, 'dist', 'catalog');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, join(destDir, 'catalog.json'));
console.log('Copied catalog snapshot to dist/catalog/catalog.json');
