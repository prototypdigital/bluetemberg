import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
    expect(() => planManagedSettings(root)).toThrow(/does not match marketplace.plugins.*backend/);
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
    expect(() => planManagedSettings(root, { plugins: ['nope'] })).toThrow(
      /--plugin nope has no Claude Code bundle/,
    );
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

  it('warns about a locked pack no bundle records (installed after the last sync)', () => {
    fixture();
    write('llm/packages-lock.json', {
      lockfileVersion: 1,
      packages: { [PACK]: LOCKED, '@acme/rules-new': { ...LOCKED, version: '0.1.0' } },
    });
    const plan = planManagedSettings(root);
    expect(plan.warnings.join('\n')).toMatch(/no plugin bundle records: @acme\/rules-new/);
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
      expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(/empty allowlist blocks every/);
    });

    it('keeps servers added to the root .mcp.json by hand, so the project does not block itself', () => {
      fixture({ mcp: { servers: ['context7'] } });
      write('.mcp.json', {
        mcpServers: {
          context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
          local: { command: 'node', args: ['tools/mcp.js'], env: { TOKEN: 'x' } },
          docs: { type: 'http', url: 'https://docs.acme.dev/mcp' },
        },
      });
      const plan = planManagedSettings(root, { mcpAllowlist: true });
      expect(plan.mcpServers).toEqual(['context7', 'docs', 'local']);
      expect(settingsFor(plan, 'copilot').allowedMcpServers).toEqual([
        { serverCommand: ['npx', '-y', '@upstash/context7-mcp'] },
        { serverCommand: ['node', 'tools/mcp.js'] },
        { serverUrl: 'https://docs.acme.dev/mcp' },
      ]);
    });

    it('allows .mcp.json servers without llm/mcp.json, and refuses a broken .mcp.json', () => {
      fixture();
      write('.mcp.json', { mcpServers: { docs: { type: 'http', url: 'https://docs.acme.dev/mcp' } } });
      expect(planManagedSettings(root, { mcpAllowlist: true }).mcpServers).toEqual(['docs']);
      write('.mcp.json', '{ not json');
      expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(/.mcp.json is not valid JSON/);
    });

    it('warns about ${VAR} in an allowlist entry', () => {
      fixture({ mcp: { servers: [{ id: 'home', type: 'stdio', command: '${HOME}/bin/mcp' }] } });
      const plan = planManagedSettings(root, { mcpAllowlist: true });
      expect(plan.warnings.join('\n')).toMatch(/uses \$\{VAR\} expansion/);
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

describe('review fixes', () => {
  it('force-enables a plugin only for the hosts that have a bundle in their format', () => {
    fixture({ plugins: ['frontend', 'Team_Tools'] });
    const plan = planManagedSettings(root);
    expect(plan.pluginsByHost).toEqual({ claude: ['frontend', 'Team_Tools'], copilot: ['frontend'] });
    expect(settingsFor(plan, 'copilot').enabledPlugins).toEqual({ 'frontend@proj': true });
    expect(() => planManagedSettings(root, { plugins: ['Team_Tools'], host: 'copilot' })).toThrow(
      /Team_Tools has no GitHub Copilot bundle/,
    );
  });

  it('names the real cause when sync could not build a configured plugin', () => {
    fixture({
      platforms: ['claude', 'agent-plugins'],
      plugins: ['frontend', 'Bad_Name'],
      indexPlugins: ['frontend'],
    });
    expect(() => planManagedSettings(root)).toThrow(/"Bad_Name" is not a valid Agent Plugins name/);
  });

  it('says plainly when drift was not checked (Claude bundles only)', () => {
    fixture({ platforms: ['claude', 'claude-marketplace'], bundlePack: null });
    const plan = planManagedSettings(root);
    expect(plan.driftChecked).toBe(false);
    expect(plan.warnings.join('\n')).toMatch(/Drift NOT checked/);
    expect(plan.files.find((f) => f.path === 'README.md')?.content).toMatch(/NOT checked against/);
  });

  it('ignores a bundle lock left behind after agent-plugins was turned off', () => {
    fixture({
      platforms: ['claude', 'claude-marketplace'],
      bundlePack: { version: '0.0.1', integrity: 'x' },
    });
    expect(() => planManagedSettings(root)).not.toThrow();
  });

  it('reports an integrity-only drift as such', () => {
    fixture({ bundlePack: { version: '1.2.0', integrity: 'sha512-other' } });
    expect(() => planManagedSettings(root)).toThrow(
      /@1.2.0 was bundled from a build with a different integrity/,
    );
  });

  it('warns about marketplaces --strict would block', () => {
    fixture();
    write('.claude/settings.json', {
      extraKnownMarketplaces: {
        proj: { source: { source: 'github', repo: 'acme/ai-marketplace' } },
        shared: { source: { source: 'github', repo: 'acme/shared-plugins' } },
        local: { source: { source: 'directory', path: '/opt/plugins' } },
      },
    });
    const warnings = planManagedSettings(root, { strict: true }).warnings.join('\n');
    expect(warnings).toMatch(/shared \(--allow-marketplace acme\/shared-plugins\)/);
    expect(warnings).toMatch(/local \(not a GitHub source/);
    expect(warnings).toMatch(/official marketplace/);
    const allowed = planManagedSettings(root, {
      strict: true,
      allowMarketplaces: ['acme/shared-plugins', 'anthropics/claude-plugins-official'],
    }).warnings.join('\n');
    expect(allowed).not.toMatch(/acme\/shared-plugins|official marketplace/);
  });

  it('refuses a .mcp.json server whose args are not all strings', () => {
    fixture();
    write('.mcp.json', { mcpServers: { odd: { command: 'node', args: ['srv.js', 8080] } } });
    expect(() => planManagedSettings(root, { mcpAllowlist: true })).toThrow(
      /"odd" has "args" that are not all strings/,
    );
  });

  it('rejects refs git check-ref-format rejects', () => {
    fixture();
    for (const ref of ['v1/', 'x.lock', 'a.', 'a//b', 'a/.b', '@{u}']) {
      expect(() => planManagedSettings(root, { ref }), ref).toThrow(/not a valid git/);
    }
    expect(planManagedSettings(root, { ref: 'release/v1.2' }).marketplace.ref).toBe('release/v1.2');
  });

  describe('writeManagedSettings safety', () => {
    it('refuses to overwrite a file it did not generate, and writes nothing', () => {
      fixture();
      const plan = planManagedSettings(root);
      write('README.md', '# My project\n');
      expect(() => writeManagedSettings(plan, root)).toThrow(/Refusing to overwrite .*README.md/);
      expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('# My project\n');
      expect(existsSync(join(root, 'claude-code'))).toBe(false);
    });

    it('regenerates over its own output', () => {
      fixture();
      const out = join(root, 'out');
      writeManagedSettings(planManagedSettings(root), out);
      expect(() => writeManagedSettings(planManagedSettings(root, { strict: true }), out)).not.toThrow();
    });

    it('refuses a symlinked host directory under --out', () => {
      fixture();
      const out = join(root, 'out');
      const elsewhere = join(root, 'elsewhere');
      mkdirSync(out);
      mkdirSync(elsewhere);
      symlinkSync(elsewhere, join(out, 'claude-code'));
      expect(() => writeManagedSettings(planManagedSettings(root), out)).toThrow(/symlink/);
      expect(readdirSync(elsewhere)).toEqual([]);
    });

    it('refuses a live host policy path', () => {
      fixture();
      expect(() => writeManagedSettings(planManagedSettings(root), '/etc')).toThrow(/live host policy path/);
    });
  });
});
