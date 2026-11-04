import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  planManagedSettings,
  writeManagedSettings,
  type ManagedSettingsPlan,
} from '../src/managed-settings/index.js';
import { getMachineReadableHelp } from '../src/help-json.js';

const PACK = '@acme/rules-frontend';
const LOCKED = { version: '1.2.0', resolved: 'https://registry.example/x.tgz', integrity: 'sha512-aaa' };

let root: string;

function write(rel: string, value: unknown): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

interface FixtureOptions {
  platforms?: string[];
  remote?: string | null;
  plugins?: string[];
  indexPlugins?: string[];
  bundlePack?: { version: string; integrity: string } | null;
  mcp?: unknown;
}

function fixture(opts: FixtureOptions = {}): void {
  const plugins = opts.plugins ?? ['frontend', 'backend'];
  write('bluetemberg.config.json', {
    platforms: opts.platforms ?? ['claude', 'claude-marketplace', 'agent-plugins'],
    source: 'llm',
    targets: {},
    marketplace: {
      ...(opts.remote === null ? {} : { remote: opts.remote ?? 'acme/ai-marketplace' }),
      plugins: plugins.map((name) => ({ name })),
    },
  });
  write('.claude-plugin/marketplace.json', {
    name: 'proj',
    owner: { name: 'acme' },
    plugins: (opts.indexPlugins ?? plugins).map((name) => ({
      name,
      description: '',
      source: `./plugins/${name}`,
    })),
  });
  write('llm/packages-lock.json', { lockfileVersion: 1, packages: { [PACK]: LOCKED } });
  if (opts.bundlePack !== null) {
    const pin = opts.bundlePack ?? { ...LOCKED };
    write('plugins/frontend/digital.prototyp.bluetemberg/bundle-lock.json', {
      lockfileVersion: 1,
      generator: 'bluetemberg',
      packs: { [PACK]: pin },
      files: {},
    });
  }
  if (opts.mcp !== undefined) write('llm/mcp.json', opts.mcp);
}

function settingsFor(plan: ManagedSettingsPlan, host: 'claude' | 'copilot'): Record<string, unknown> {
  const file = plan.files.find((f) => f.host === host);
  if (!file) throw new Error(`no ${host} file`);
  return JSON.parse(file.content) as Record<string, unknown>;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bluetemberg-managed-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('planManagedSettings', () => {
  it('registers the marketplace and force-enables every published plugin for both hosts', () => {
    fixture();
    const plan = planManagedSettings(root);

    expect(plan.hosts).toEqual(['claude', 'copilot']);
    for (const host of ['claude', 'copilot'] as const) {
      const settings = settingsFor(plan, host);
      expect(settings.extraKnownMarketplaces).toEqual({
        proj: { source: { source: 'github', repo: 'acme/ai-marketplace' } },
      });
      expect(settings.enabledPlugins).toEqual({ 'frontend@proj': true, 'backend@proj': true });
      expect(settings).not.toHaveProperty('strictKnownMarketplaces');
      expect(settings).not.toHaveProperty('allowedMcpServers');
      expect(settings).not.toHaveProperty('deniedMcpServers');
    }
    expect(plan.packs).toEqual({ [PACK]: { version: '1.2.0', integrity: 'sha512-aaa' } });
    expect(plan.files.map((f) => f.path)).toEqual([
      'claude-code/managed-settings.json',
      'github-copilot/managed-settings.json',
      'README.md',
    ]);
  });

  it('writes the $schema key only into the Claude Code file', () => {
    fixture();
    const plan = planManagedSettings(root);
    expect(settingsFor(plan, 'claude').$schema).toBe(
      'https://json.schemastore.org/claude-code-settings.json',
    );
    expect(settingsFor(plan, 'copilot')).not.toHaveProperty('$schema');
  });

  it('defaults to the hosts whose bundle platform is enabled', () => {
    fixture({ platforms: ['claude', 'claude-marketplace'], bundlePack: null });
    expect(planManagedSettings(root).hosts).toEqual(['claude']);
  });

  it('refuses a host whose bundles are not built', () => {
    fixture({ platforms: ['claude', 'claude-marketplace'], bundlePack: null });
    expect(() => planManagedSettings(root, { host: 'copilot' })).toThrow(
      /"agent-plugins" is not in platforms/,
    );
    expect(() => planManagedSettings(root, { host: 'all' })).toThrow(/agent-plugins/);
  });

  it('refuses to run without a configured marketplace', () => {
    fixture({ remote: null });
    expect(() => planManagedSettings(root)).toThrow(/No marketplace is configured/);
  });

  it('refuses a marketplace remote that is not owner/repo', () => {
    fixture({ remote: 'https://github.com/acme/x' });
    expect(() => planManagedSettings(root)).toThrow(/not a GitHub owner\/repo/);
  });

  it('refuses without a generated marketplace index', () => {
    fixture();
    rmSync(join(root, '.claude-plugin'), { recursive: true });
    expect(() => planManagedSettings(root)).toThrow(/run "bluetemberg sync" first/);
  });

  it('refuses when the index is stale against marketplace.plugins', () => {
    fixture({ indexPlugins: ['frontend'] });
    expect(() => planManagedSettings(root)).toThrow(/out of date.*backend/);
  });

  it('pins the same ref in extraKnownMarketplaces and strictKnownMarketplaces', () => {
    fixture();
    const plan = planManagedSettings(root, { ref: 'v1.2.0', strict: true });
    for (const host of ['claude', 'copilot'] as const) {
      const settings = settingsFor(plan, host);
      const registered = (settings.extraKnownMarketplaces as Record<string, { source: unknown }>).proj.source;
      const allowed = (settings.strictKnownMarketplaces as unknown[])[0];
      expect(registered).toEqual({ source: 'github', repo: 'acme/ai-marketplace', ref: 'v1.2.0' });
      expect(allowed).toEqual(registered);
    }
  });

  it('keeps skills-directory plugins loading under a Claude Code allowlist, and only there', () => {
    fixture();
    const plan = planManagedSettings(root, { strict: true });
    expect(settingsFor(plan, 'claude').strictKnownMarketplaces).toContainEqual({ source: 'skills-dir' });
    expect(settingsFor(plan, 'copilot').strictKnownMarketplaces).not.toContainEqual({ source: 'skills-dir' });
  });

  it('adds --allow-marketplace repos to the allowlist without duplicating ours', () => {
    fixture();
    const plan = planManagedSettings(root, {
      strict: true,
      allowMarketplaces: ['anthropics/claude-plugins-official', 'acme/ai-marketplace'],
    });
    expect(settingsFor(plan, 'copilot').strictKnownMarketplaces).toEqual([
      { source: 'github', repo: 'acme/ai-marketplace' },
      { source: 'github', repo: 'anthropics/claude-plugins-official' },
    ]);
  });

  it('rejects --allow-marketplace without --strict, and a non owner/repo value', () => {
    fixture();
    expect(() => planManagedSettings(root, { allowMarketplaces: ['a/b'] })).toThrow(
      /only applies with --strict/,
    );
    expect(() => planManagedSettings(root, { strict: true, allowMarketplaces: ['acme/*'] })).toThrow(
      /not a GitHub owner\/repo/,
    );
  });

  it('accepts a commit SHA ref for Copilot only', () => {
    fixture();
    const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
    expect(() => planManagedSettings(root, { ref: sha })).toThrow(
      /Claude Code pins a marketplace to a branch or tag/,
    );
    const plan = planManagedSettings(root, { ref: sha, host: 'copilot' });
    expect(plan.marketplace.ref).toBe(sha);
  });

  it('rejects a ref git would not accept', () => {
    fixture();
    expect(() => planManagedSettings(root, { ref: '--upload-pack=x' })).toThrow(/not a valid git/);
    expect(() => planManagedSettings(root, { ref: 'a..b' })).toThrow(/not a valid git/);
  });

  it('sets autoUpdate only when asked', () => {
    fixture();
    const plan = planManagedSettings(root, { autoUpdate: true });
    expect(settingsFor(plan, 'copilot').extraKnownMarketplaces).toEqual({
      proj: { source: { source: 'github', repo: 'acme/ai-marketplace' }, autoUpdate: true },
    });
  });

  it('force-enables only the selected plugins and rejects unknown ones', () => {
    fixture();
    const plan = planManagedSettings(root, { plugins: ['backend'] });
    expect(settingsFor(plan, 'claude').enabledPlugins).toEqual({ 'backend@proj': true });
    expect(() => planManagedSettings(root, { plugins: ['nope'] })).toThrow(/--plugin nope is not in/);
  });

  it('refuses when a bundle was built from a pack version the lockfile no longer has', () => {
    fixture({ bundlePack: { version: '1.1.0', integrity: 'sha512-old' } });
    expect(() => planManagedSettings(root)).toThrow(
      /frontend: @acme\/rules-frontend bundled 1.1.0, lockfile has 1.2.0/,
    );
  });

  it('refuses when a bundled pack was removed from the lockfile', () => {
    fixture();
    write('llm/packages-lock.json', { lockfileVersion: 1, packages: {} });
    expect(() => planManagedSettings(root)).toThrow(/no longer in packages-lock.json/);
  });

  it('warns that drift could not be checked when no bundle locks exist', () => {
    fixture({ bundlePack: null });
    const plan = planManagedSettings(root);
    expect(plan.warnings.join('\n')).toMatch(/could not be checked against packages-lock.json/);
    expect(plan.packs).toEqual({ [PACK]: { version: '1.2.0', integrity: 'sha512-aaa' } });
  });

  describe('MCP allowlist', () => {
    it('lists the project servers by exact command or URL', () => {
      fixture({
        mcp: { servers: ['context7', { id: 'internal', type: 'http', url: 'https://mcp.acme.dev/mcp' }] },
      });
      const plan = planManagedSettings(root, { mcpAllowlist: true });
      expect(plan.mcpServers).toEqual(['context7', 'internal']);
      expect(settingsFor(plan, 'claude').allowedMcpServers).toEqual([
        { serverCommand: ['npx', '-y', '@upstash/context7-mcp'] },
        { serverUrl: 'https://mcp.acme.dev/mcp' },
      ]);
    });

    it('never writes an empty allowlist, which would block every server', () => {
      fixture({ mcp: { servers: [] } });
      expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(/empty allowlist blocks every/);
      rmSync(join(root, 'llm', 'mcp.json'));
      expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(/needs llm\/mcp.json/);
    });

    it('refuses a manifest with errors or a server it cannot match', () => {
      fixture({ mcp: { servers: ['not-a-preset'] } });
      expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(/llm\/mcp.json has errors/);
      fixture({ mcp: { servers: [{ id: 'bare', type: 'stdio' }] } });
      expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(
        /"bare" has neither a command nor a url/,
      );
    });
  });

  describe('README', () => {
    it('names every deploy path for each host', () => {
      fixture();
      const readme = planManagedSettings(root).files.find((f) => f.path === 'README.md')?.content ?? '';
      expect(readme).toContain('/Library/Application Support/ClaudeCode/managed-settings.json');
      expect(readme).toContain('/etc/claude-code/managed-settings.json');
      expect(readme).toContain('C:\\Program Files\\ClaudeCode\\managed-settings.json');
      expect(readme).toContain('/Library/Application Support/GitHubCopilot/managed-settings.json');
      expect(readme).toContain('/etc/github-copilot/managed-settings.json');
      expect(readme).toContain('%ProgramFiles%\\GitHubCopilot\\managed-settings.json');
      expect(readme).toContain('copilot/managed-settings.json');
      expect(readme).toContain('`enabledPlugins` | `{"frontend@proj":true,"backend@proj":true}`');
      expect(readme).not.toContain('Before you deploy the marketplace allowlist');
    });

    it('explains the lockout when the allowlist is on', () => {
      fixture();
      const readme = planManagedSettings(root, { strict: true }).files.find(
        (f) => f.path === 'README.md',
      )?.content;
      expect(readme).toContain('anthropics/claude-plugins-official');
      expect(readme).toContain('Matching is exact, `ref` included');
    });
  });
});

describe('writeManagedSettings', () => {
  it('writes only the planned files, under the output directory', () => {
    fixture();
    const plan = planManagedSettings(root);
    const out = join(root, 'out');
    const written = writeManagedSettings(plan, out);

    expect(written).toEqual([
      join(out, 'claude-code', 'managed-settings.json'),
      join(out, 'github-copilot', 'managed-settings.json'),
      join(out, 'README.md'),
    ]);
    expect(readdirSync(out).sort()).toEqual(['README.md', 'claude-code', 'github-copilot']);
    expect(JSON.parse(readFileSync(written[0], 'utf8'))).toEqual(settingsFor(plan, 'claude'));
  });

  it('refuses a file path that escapes the output directory', () => {
    fixture();
    const plan = planManagedSettings(root);
    const escaping = { ...plan, files: [{ path: '../escape.json', content: '{}' }] };
    expect(() => writeManagedSettings(escaping, join(root, 'out'))).toThrow(/Refusing to write outside/);
    expect(existsSync(join(root, 'escape.json'))).toBe(false);
  });

  it('leaves the project untouched (planning writes nothing)', () => {
    fixture();
    const before = readdirSync(root).sort();
    planManagedSettings(root, { strict: true, mcpAllowlist: false });
    expect(readdirSync(root).sort()).toEqual(before);
  });
});

describe('help --json', () => {
  it('documents the managed-settings command', () => {
    const help = getMachineReadableHelp() as {
      managedSettings: { command: string; options: { long: string }[] };
    };
    expect(help.managedSettings.command).toBe('managed-settings');
    expect(help.managedSettings.options.map((o) => o.long)).toContain('--strict');
  });
});

describe('marketplace name', () => {
  it('warns when the index name is not the folder name sync would use', () => {
    fixture();
    const plan = planManagedSettings(root);
    expect(plan.warnings.join('\n')).toMatch(/index is named "proj"/);
  });
});
