#!/usr/bin/env node
import { mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, '_site');

mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'site', 'index.html'), join(out, 'index.html'));

console.log('Site built → _site/');
