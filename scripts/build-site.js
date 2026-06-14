#!/usr/bin/env node
import { mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'site', 'index.html');
const out = join(root, '_site');

try {
  mkdirSync(out, { recursive: true });
  copyFileSync(src, join(out, 'index.html'));
  console.log('Site built → _site/');
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
