import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach } from 'vitest';
import { clearRegistryAuthCache } from '../../src/registry/auth.js';

/** Env vars the auth resolver consults; cleared so a real CI token never leaks in. */
const CREDENTIAL_ENV_VARS = ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_CONFIG_USERCONFIG'] as const;

/**
 * Isolate registry credential resolution for a test file.
 *
 * Credentials come from `.npmrc` files and the environment, so without this a test run
 * would silently pick up the developer's `~/.npmrc` or CI's `NODE_AUTH_TOKEN` and assert
 * against whatever happened to be on the machine. Each test gets an empty temp dir as
 * both cwd (for the project `.npmrc`) and user config.
 *
 * @returns A `write` helper that seeds an `.npmrc` for the current test.
 */
export function isolateRegistryAuth(): {
  writeProjectNpmrc(contents: string): void;
  writeUserNpmrc(contents: string): void;
} {
  let dir: string;
  let originalCwd: string;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'bluetemberg-npmrc-'));

    for (const name of CREDENTIAL_ENV_VARS) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    process.env.NPM_CONFIG_USERCONFIG = join(dir, 'user.npmrc');

    process.chdir(dir);
    clearRegistryAuthCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
    clearRegistryAuthCache();
    rmSync(dir, { recursive: true, force: true });
  });

  return {
    writeProjectNpmrc(contents: string) {
      writeFileSync(join(process.cwd(), '.npmrc'), contents);
      clearRegistryAuthCache();
    },
    writeUserNpmrc(contents: string) {
      writeFileSync(join(dir, 'user.npmrc'), contents);
      clearRegistryAuthCache();
    },
  };
}
