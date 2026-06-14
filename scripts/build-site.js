#!/usr/bin/env node
import { mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('..', import.meta.url));
const siteDir = join(root, 'site');
const out = join(root, '_site');

try {
  mkdirSync(out, { recursive: true });
  copyFileSync(join(siteDir, 'index.html'), join(out, 'index.html'));

  const assets = readdirSync(siteDir).filter((file) => file.endsWith('.svg'));
  for (const asset of assets) {
    copyFileSync(join(siteDir, asset), join(out, asset));
  }

  const suffix = assets.length === 1 ? '' : 's';
  console.log(`Site built → _site/ (index.html + ${assets.length} SVG asset${suffix})`);
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
