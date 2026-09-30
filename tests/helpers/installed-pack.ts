import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function addPackageEntry(path: string, base: Record<string, unknown>, name: string, entry: unknown): void {
  const current = readJson(path);
  const packages = { ...((current.packages as Record<string, unknown> | undefined) ?? {}), [name]: entry };
  writeFileSync(path, JSON.stringify({ ...base, ...current, packages }));
}

/**
 * Fake an installed registry pack: manifest + lockfile entry + extracted content in the pack cache,
 * including the `package.json` every npm tarball carries (it is what attributes the pack's files to
 * its catalog entry). Merges into an existing manifest, so several packs can be installed.
 *
 * @returns The pack's source dir (`.bluetemberg/packs/<name>/<version>/llm`) to write content into.
 */
export function installFakePack(root: string, name: string, version = '0.1.0', source = 'llm'): string {
  mkdirSync(join(root, source), { recursive: true });
  addPackageEntry(join(root, source, 'packages.json'), {}, name, `^${version}`);
  addPackageEntry(join(root, source, 'packages-lock.json'), { lockfileVersion: 1 }, name, {
    version,
    resolved: 'https://example.invalid/x.tgz',
    integrity: 'sha512-x',
  });

  const base = join(root, '.bluetemberg', 'packs', name, version);
  mkdirSync(join(base, 'llm'), { recursive: true });
  writeFileSync(join(base, 'package.json'), JSON.stringify({ name, version }));
  return join(base, 'llm');
}
