import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
// Ajv is already in the tree (a dependency of @modelcontextprotocol/sdk); the 2020-12 build matches
// the dialect the Agent Plugins schemas declare.
import Ajv2020 from 'ajv/dist/2020.js';
import { sync } from '../src/sync/index.js';
import { uninstall } from '../src/uninstall/index.js';
import { eject } from '../src/eject/index.js';
import { buildWhyReport, formatWhyReport } from '../src/stacks/why.js';
import { preview } from '../src/preview/index.js';
import { loadCatalogSync } from '../src/catalog/index.js';
import { isValidAgentPluginName } from '../src/sync/agent-plugins.js';
import { toPluginName } from '../src/sync/marketplace.js';
import type { BlueprintConfig, Platform } from '../src/types.js';
import { installFakePack } from './helpers/installed-pack.js';

const SCHEMA_PATH = fileURLToPath(
  new URL('./fixtures/agent-plugins/1.0.0/plugin.schema.json', import.meta.url),
);
const pluginSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateManifest = ajv.compile(pluginSchema);

/** Agent Skills spec: lowercase letters, digits and single hyphens, at most 64 chars. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function createTmpDir(): string {
  const dir = join(
    tmpdir(),
    `bluetemberg-agent-plugins-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function config(platforms: Platform[], extra: Partial<BlueprintConfig> = {}): BlueprintConfig {
  return { platforms, source: 'llm', targets: {}, ...extra };
}

function writeConfig(root: string, cfg: BlueprintConfig): void {
  writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(cfg, null, 2));
}

function writeSkill(sourceDir: string, name: string, frontmatter = ''): void {
  mkdirSync(join(sourceDir, 'skills', name, 'scripts'), { recursive: true });
  writeFileSync(
    join(sourceDir, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
  writeFileSync(join(sourceDir, 'skills', name, 'scripts', 'run.sh'), '#!/bin/sh\necho ok\n');
}

function writeAgent(sourceDir: string, name: string, frontmatter = ''): void {
  mkdirSync(join(sourceDir, 'agents'), { recursive: true });
  writeFileSync(
    join(sourceDir, 'agents', `${name}.md`),
    `---\nname: ${name}\ndescription: ${name} description${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function writeRule(sourceDir: string, name: string, frontmatter = ''): void {
  mkdirSync(join(sourceDir, 'rules'), { recursive: true });
  writeFileSync(
    join(sourceDir, 'rules', `${name}.md`),
    `---\ndescription: ${name} description${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n\nBody.\n`,
  );
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function sri(path: string): string {
  return `sha256-${createHash('sha256').update(readFileSync(path)).digest('base64')}`;
}

/** Every file under `dir`, plugin-relative with forward slashes. */
function listFiles(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((ent) => {
    const child = rel ? `${rel}/${ent.name}` : ent.name;
    return ent.isDirectory() ? listFiles(dir, child) : [child];
  });
}

/** What a conformant client checks before loading: schema-valid manifest, spec-valid skills. */
function expectConformantBundle(pluginDir: string): void {
  const manifest = readJson(join(pluginDir, 'plugin.json'));
  const valid = validateManifest(manifest);
  expect(validateManifest.errors ?? [], JSON.stringify(validateManifest.errors)).toEqual([]);
  expect(valid).toBe(true);

  for (const skillDir of readdirSync(join(pluginDir, 'skills'))) {
    const { data } = matter(readFileSync(join(pluginDir, 'skills', skillDir, 'SKILL.md'), 'utf8'));
    expect(data.name).toBe(skillDir);
    expect(String(data.name)).toMatch(SKILL_NAME);
    expect(String(data.name).length).toBeLessThanOrEqual(64);
    expect(typeof data.description).toBe('string');
    expect(String(data.description).length).toBeGreaterThan(0);
    expect(String(data.description).length).toBeLessThanOrEqual(1024);
  }
}

describe('agent-plugins platform', () => {
  let root: string;
  let src: string;
  let name: string;

  beforeEach(() => {
    root = createTmpDir();
    src = join(root, 'llm');
    name = basename(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('validator rejects a manifest the spec rejects (sanity check on the fixture)', () => {
    expect(validateManifest({ $schema: pluginSchema.$id, name: 'Bad--Name' })).toBe(false);
    expect(validateManifest({ $schema: pluginSchema.$id, name: 'ok', skills: [] })).toBe(false);
    expect(validateManifest({ $schema: pluginSchema.$id, name: 'ok' })).toBe(true);
  });

  it('emits a schema-valid Agent Plugins bundle without the Claude manifest', async () => {
    writeSkill(src, 'api-design');
    writeRule(src, 'naming');
    writeAgent(src, 'reviewer');

    const results = await sync(root, { config: config(['agent-plugins']), silent: true });
    expect(results.errors).toEqual([]);

    const pluginDir = join(root, 'plugins', name);
    expectConformantBundle(pluginDir);
    expect(readJson(join(pluginDir, 'plugin.json'))).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name,
      author: { name },
    });
    expect(existsSync(join(pluginDir, 'skills', 'api-design', 'scripts', 'run.sh'))).toBe(true);
    expect(existsSync(join(pluginDir, 'skills', 'rule-naming', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(pluginDir, 'com.github.copilot', 'agents', 'reviewer.agent.md'))).toBe(true);
    // Claude-only parts stay out.
    expect(existsSync(join(pluginDir, '.claude-plugin'))).toBe(false);
    expect(existsSync(join(pluginDir, 'agents'))).toBe(false);
    // The shared marketplace index lists it.
    const index = readJson(join(root, '.claude-plugin', 'marketplace.json'));
    expect(index.plugins).toEqual([{ name, description: '', source: `./plugins/${name}` }]);
  });

  it('writes both formats into one directory when both platforms are on', async () => {
    writeSkill(src, 'api-design');
    writeAgent(src, 'reviewer');

    const results = await sync(root, {
      config: config(['claude-marketplace', 'agent-plugins']),
      silent: true,
    });
    expect(results.errors).toEqual([]);

    const pluginDir = join(root, 'plugins', name);
    expectConformantBundle(pluginDir);
    expect(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(pluginDir, 'agents', 'reviewer.md'))).toBe(true);
    expect(existsSync(join(pluginDir, 'com.github.copilot', 'agents', 'reviewer.agent.md'))).toBe(true);
  });

  it('bundle lock digests every client-read file and records the packs it came from', async () => {
    const packDir = installFakePack(root, '@acme/rules-naming', '1.2.3');
    writeRule(packDir, 'naming');
    writeSkill(src, 'local-skill');

    const results = await sync(root, { config: config(['agent-plugins']), silent: true });
    expect(results.errors).toEqual([]);

    const pluginDir = join(root, 'plugins', name);
    const lock = readJson(join(pluginDir, 'digital.prototyp.bluetemberg', 'bundle-lock.json'));
    expect(lock.lockfileVersion).toBe(1);
    expect(lock.generator).toBe('bluetemberg');
    expect(lock.agentPlugins).toBe('1.0.0');
    expect(lock.packs).toEqual({
      '@acme/rules-naming': {
        version: '1.2.3',
        resolved: 'https://example.invalid/x.tgz',
        integrity: 'sha512-x',
      },
    });

    const covered = listFiles(pluginDir).filter((f) => !f.startsWith('digital.prototyp'));
    const files = lock.files as Record<string, string>;
    expect(Object.keys(files).sort()).toEqual(covered.sort());
    for (const [rel, digest] of Object.entries(files)) expect(digest).toBe(sri(join(pluginDir, rel)));
  });

  it('carries profiles, stacks, owner and remote into the manifest', async () => {
    writeSkill(src, 'react-patterns', 'profiles: [frontend]');
    const cfg = config(['agent-plugins'], {
      marketplace: {
        remote: 'acme/agent-plugins',
        owner: { name: 'Acme', email: 'dev@acme.test' },
        plugins: [
          { name: 'acme.frontend', description: 'Frontend kit', profiles: ['frontend'], stacks: ['react'] },
        ],
      },
    });

    const results = await sync(root, { config: cfg, silent: true });
    expect(results.errors).toEqual([]);

    const pluginDir = join(root, 'plugins', 'acme.frontend');
    expectConformantBundle(pluginDir);
    expect(readJson(join(pluginDir, 'plugin.json'))).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'acme.frontend',
      description: 'Frontend kit',
      author: { name: 'Acme', email: 'dev@acme.test' },
      repository: 'https://github.com/acme/agent-plugins',
      keywords: ['frontend', 'react'],
    });
    // agent-plugins alone never touches Claude settings, even with a remote.
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('rejects a plugin name the spec does not allow', async () => {
    writeSkill(src, 'api-design');
    const cfg = config(['agent-plugins'], { marketplace: { plugins: [{ name: 'Frontend_Kit' }] } });

    const results = await sync(root, { config: cfg, silent: true });
    expect(results.errors.join('\n')).toContain('"Frontend_Kit" is not a valid Agent Plugins name');
    expect(existsSync(join(root, 'plugins', 'Frontend_Kit'))).toBe(false);
  });

  it('isValidAgentPluginName follows spec §5.5', () => {
    for (const ok of ['my-plugin', 'acme.tools', 'lint3r', 'a'])
      expect(isValidAgentPluginName(ok)).toBe(true);
    for (const bad of ['My-Plugin', '-start', 'has--double', 'too.many..dots', '', 'end-', 'x'.repeat(65)]) {
      expect(isValidAgentPluginName(bad)).toBe(false);
    }
  });

  it('never renames the default plugin; an invalid name fails only with agent-plugins alone', async () => {
    const odd = join(root, 'My_App');
    mkdirSync(odd);
    writeSkill(join(odd, 'llm'), 'api-design');

    const claudeOnly = await sync(odd, { config: config(['claude-marketplace']), silent: true });
    expect(claudeOnly.errors).toEqual([]);
    expect(existsSync(join(odd, 'plugins', 'My_App', '.claude-plugin', 'plugin.json'))).toBe(true);

    const apOnly = await sync(odd, { config: config(['agent-plugins']), silent: true });
    expect(apOnly.errors.join('\n')).toContain(
      '"My_App" is not a valid Agent Plugins name, so it is skipped',
    );
    expect(apOnly.errors.join('\n')).toContain('(e.g. "my-app")');
    expect(toPluginName('--Weird..Name__')).toBe('weird.name');
    expect(toPluginName('___')).toBe('plugin');
  });

  it('an invalid Agent Plugins name keeps the plugin in the Claude marketplace', async () => {
    writeSkill(src, 'api-design');
    const cfg = config(['claude-marketplace', 'agent-plugins'], {
      marketplace: { plugins: [{ name: 'Kit_A' }] },
    });

    const results = await sync(root, { config: cfg, silent: true });
    expect(results.errors).toEqual([]);
    expect(results.warnings.join('\n')).toContain('so its Agent Plugins files are skipped');
    const pluginDir = join(root, 'plugins', 'Kit_A');
    expect(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(pluginDir, 'plugin.json'))).toBe(false);
    expect((readJson(join(root, '.claude-plugin', 'marketplace.json')).plugins as unknown[]).length).toBe(1);
  });

  it('rule skills get parseable frontmatter whatever the description holds', async () => {
    writeRule(src, 'colon', 'name: colon');
    writeFileSync(join(src, 'rules', 'colon.md'), '---\ndescription: "Use when: editing"\n---\n\nBody.\n');
    writeFileSync(join(src, 'rules', 'bare.md'), '# No frontmatter\n\nBody.\n');
    writeFileSync(join(src, 'rules', 'dash.md'), '---\ndescription: "- starts with a dash"\n---\n\nBody.\n');

    const results = await sync(root, { config: config(['agent-plugins']), silent: true });
    expect(results.errors).toEqual([]);
    expect(results.warnings).toEqual([]);
    expectConformantBundle(join(root, 'plugins', name));
    const bare = matter(readFileSync(join(root, 'plugins', name, 'skills', 'rule-bare', 'SKILL.md'), 'utf8'));
    expect(bare.data.description).toBe('Guidance: bare');
  });

  it('keeps the rule name in Claude-only rule skills (unchanged output)', async () => {
    writeRule(src, 'naming');
    await sync(root, { config: config(['claude-marketplace']), silent: true });
    const skill = matter(
      readFileSync(join(root, 'plugins', name, 'skills', 'rule-naming', 'SKILL.md'), 'utf8'),
    );
    expect(skill.data.name).toBe('naming');
  });

  it('warns once about a bundle skill a host would skip', async () => {
    mkdirSync(join(src, 'skills', 'Bad_Dir'), { recursive: true });
    writeFileSync(join(src, 'skills', 'Bad_Dir', 'SKILL.md'), '---\nname: bad-dir\ndescription: d\n---\n');
    mkdirSync(join(src, 'skills', 'renamed'), { recursive: true });
    writeFileSync(join(src, 'skills', 'renamed', 'SKILL.md'), '---\nname: other\ndescription: d\n---\n');
    const cfg = config(['agent-plugins'], { marketplace: { plugins: [{ name: 'a' }, { name: 'b' }] } });

    const results = await sync(root, { config: cfg, silent: true });
    const warnings = results.warnings.filter((w) => w.includes('Agent Skills spec'));
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('skill "Bad_Dir"');
    expect(warnings.join('\n')).toContain('"name" must equal the directory name "renamed"');
  });

  it('bundle skills carry no per-skill pack stamp; the bundle lock is the provenance record', async () => {
    const packDir = installFakePack(root, '@acme/skills-x', '1.0.0');
    writeSkill(packDir, 'xs');

    const results = await sync(root, { config: config(['claude', 'agent-plugins']), silent: true });
    expect(results.errors).toEqual([]);
    const pluginDir = join(root, 'plugins', name);
    expect(readFileSync(join(pluginDir, 'skills', 'xs', 'SKILL.md'), 'utf8')).not.toContain(
      'bluetemberg-pack',
    );
    const lock = readJson(join(pluginDir, 'digital.prototyp.bluetemberg', 'bundle-lock.json'));
    expect(Object.keys(lock.packs as object)).toEqual(['@acme/skills-x']);
  });

  it('a skill with Agent Skills `metadata` still conforms in a bundle', async () => {
    mkdirSync(join(src, 'skills', 'meta-skill'), { recursive: true });
    writeFileSync(
      join(src, 'skills', 'meta-skill', 'SKILL.md'),
      '---\nname: meta-skill\ndescription: d\nmetadata:\n  bluetemberg-pack: "@acme/x"\n  author: me\n---\nbody\n',
    );

    const results = await sync(root, { config: config(['agent-plugins']), silent: true });
    expect(results.warnings).toEqual([]);
    expectConformantBundle(join(root, 'plugins', name));
  });

  describe('platform routing (#281) and scoped extends (#207)', () => {
    it('keeps content limited to claude out of an Agent Plugins-only bundle', async () => {
      writeSkill(src, 'claude-only', 'platforms: [claude]');
      writeAgent(src, 'claude-agent', 'platforms: [claude]');
      writeSkill(src, 'portable');

      const results = await sync(root, { config: config(['agent-plugins']), silent: true });
      expect(results.errors).toEqual([]);
      const pluginDir = join(root, 'plugins', name);
      expect(existsSync(join(pluginDir, 'skills', 'portable', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(pluginDir, 'skills', 'claude-only'))).toBe(false);
      expect(existsSync(join(pluginDir, 'com.github.copilot', 'agents', 'claude-agent.agent.md'))).toBe(
        false,
      );
    });

    it('takes content that names agent-plugins, and only into the Agent Plugins parts', async () => {
      writeAgent(src, 'ap-agent', 'platforms: [agent-plugins]');
      writeAgent(src, 'claude-agent', 'platforms: [claude]');
      writeSkill(src, 'ap-skill', 'platforms: [agent-plugins]');

      const results = await sync(root, {
        config: config(['claude-marketplace', 'agent-plugins']),
        silent: true,
      });
      expect(results.errors).toEqual([]);
      expect(results.warnings.join('\n')).not.toContain('unknown');
      const pluginDir = join(root, 'plugins', name);
      expect(existsSync(join(pluginDir, 'com.github.copilot', 'agents', 'ap-agent.agent.md'))).toBe(true);
      expect(existsSync(join(pluginDir, 'agents', 'ap-agent.md'))).toBe(false);
      expect(existsSync(join(pluginDir, 'agents', 'claude-agent.md'))).toBe(true);
      expect(existsSync(join(pluginDir, 'com.github.copilot', 'agents', 'claude-agent.agent.md'))).toBe(
        false,
      );
      // `skills/` is shared by both formats, so a skill either format takes is written there.
      expect(existsSync(join(pluginDir, 'skills', 'ap-skill', 'SKILL.md'))).toBe(true);
      const claudeManifest = readJson(join(pluginDir, '.claude-plugin', 'plugin.json'));
      expect(JSON.stringify(claudeManifest.agents)).not.toContain('ap-agent');
    });

    it('counts a bundle that has only Copilot agents as non-empty', async () => {
      writeAgent(src, 'ap-agent', 'platforms: [agent-plugins]');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const results = await sync(root, { config: config(['agent-plugins']) });
        expect(results.errors).toEqual([]);
        expect(logSpy.mock.calls.flat().join('\n')).toContain(`plugins/${name}/ (0 skills, 1 agents)`);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('does not take content limited to a host such as copilot', async () => {
      writeSkill(src, 'copilot-only', 'platforms: [copilot]');
      writeSkill(src, 'portable');

      await sync(root, { config: config(['agent-plugins']), silent: true });
      expect(existsSync(join(root, 'plugins', name, 'skills', 'copilot-only'))).toBe(false);
    });

    it('why reports only the bundle parts an item is written to', () => {
      writeAgent(src, 'claude-agent', 'platforms: [claude]');
      writeConfig(root, config(['claude-marketplace', 'agent-plugins']));

      const report = buildWhyReport(root, 'claude-agent');
      expect(report.matches[0]?.outputs).toEqual([`plugins/${name}/agents/claude-agent.md`]);
    });

    it('fails when scoped extends give the two bundle platforms different content', async () => {
      writeSkill(join(root, 'extra', 'llm'), 'extra-skill');
      writeSkill(src, 'local');

      const split = await sync(root, {
        config: config(['claude-marketplace', 'agent-plugins'], {
          extends: [{ path: './extra', platforms: ['agent-plugins'] }],
        }),
        silent: true,
      });
      expect(split.errors.join('\n')).toContain(
        'give claude-marketplace, agent-plugins different content for plugins/',
      );
    });

    it('accepts an entry scoped to both bundle platforms', async () => {
      writeSkill(join(root, 'extra', 'llm'), 'extra-skill');
      writeSkill(src, 'local');

      const results = await sync(root, {
        config: config(['claude', 'claude-marketplace', 'agent-plugins'], {
          extends: [{ path: './extra', platforms: ['claude-marketplace', 'agent-plugins'] }],
        }),
        silent: true,
      });
      expect(results.errors).toEqual([]);
      expect(existsSync(join(root, 'plugins', name, 'skills', 'extra-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(root, '.claude', 'skills', 'extra-skill'))).toBe(false);
      expectConformantBundle(join(root, 'plugins', name));
    });
  });

  it('warns before replacing a root plugin.json bluetemberg did not write', async () => {
    writeSkill(src, 'api-design');
    mkdirSync(join(root, 'plugins', name), { recursive: true });
    writeFileSync(join(root, 'plugins', name, 'plugin.json'), '{"name":"mine"}');

    const first = await sync(root, { config: config(['agent-plugins']), silent: true });
    expect(first.warnings.join('\n')).toContain('was not written by bluetemberg and is replaced');
    const second = await sync(root, { config: config(['agent-plugins']), silent: true });
    expect(second.warnings).toEqual([]);
  });

  it('preview lists only the bundles sync writes for the profile', async () => {
    writeConfig(
      root,
      config(['agent-plugins'], {
        marketplace: {
          plugins: [
            { name: 'fe', profiles: ['frontend'] },
            { name: 'be', profiles: ['backend'] },
            { name: 'All_Bad' },
            { name: 'everyone' },
          ],
        },
      }),
    );
    // A fresh catalog cache keeps `preview` offline (it fetches only when the cache is stale).
    mkdirSync(join(root, '.bluetemberg'), { recursive: true });
    const catalog = { ...loadCatalogSync(root), generated: new Date().toISOString() };
    writeFileSync(join(root, '.bluetemberg', 'catalog.json'), JSON.stringify(catalog));
    const lines: string[] = [];
    await preview(root, 'frontend', { log: (msg) => lines.push(msg) });
    const out = lines.join('\n');
    expect(out).toContain('plugins/fe/');
    expect(out).toContain('plugins/everyone/');
    expect(out).not.toContain('plugins/be/');
    expect(out).not.toContain('plugins/All_Bad/');
  });

  it('why lists bundle paths for an item the project stack gate excludes', () => {
    writeRule(src, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { payload: '2.30.0' } }));
    writeConfig(
      root,
      config(['agent-plugins'], { marketplace: { plugins: [{ name: 'cms', stacks: ['payload'] }] } }),
    );

    const report = buildWhyReport(root, 'payload-v3');
    expect(report.matches[0]?.included).toBe(false);
    expect(report.matches[0]?.outputs).toEqual(['plugins/cms/skills/rule-payload-v3/SKILL.md']);
    expect(formatWhyReport(report).join('\n')).toContain(
      'outputs:    plugins/cms/skills/rule-payload-v3/SKILL.md',
    );
  });

  it('--check is clean right after a sync (the lock is deterministic)', async () => {
    writeSkill(src, 'api-design');
    writeAgent(src, 'reviewer');
    await sync(root, { config: config(['agent-plugins']), silent: true });

    const check = await sync(root, { config: config(['agent-plugins']), silent: true, check: true });
    expect(check.outOfSync).toBe(0);

    // A source edit changes the skill and its digest in the lock: both are reported.
    writeFileSync(
      join(src, 'skills', 'api-design', 'SKILL.md'),
      '---\nname: api-design\ndescription: v2\n---\n',
    );
    const drift = await sync(root, { config: config(['agent-plugins']), silent: true, check: true });
    expect(drift.outOfSync).toBe(2);
  });

  it('prune drops the Agent Plugins files when only claude-marketplace is left', async () => {
    writeSkill(src, 'api-design');
    writeAgent(src, 'reviewer');
    await sync(root, { config: config(['claude-marketplace', 'agent-plugins']), silent: true });

    const results = await sync(root, { config: config(['claude-marketplace']), silent: true, prune: true });
    expect(results.errors).toEqual([]);

    const pluginDir = join(root, 'plugins', name);
    expect(existsSync(join(pluginDir, 'plugin.json'))).toBe(false);
    expect(existsSync(join(pluginDir, 'digital.prototyp.bluetemberg'))).toBe(false);
    expect(existsSync(join(pluginDir, 'com.github.copilot'))).toBe(false);
    expect(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(pluginDir, 'skills', 'api-design', 'SKILL.md'))).toBe(true);
  });

  it('prune keeps a hand-written root plugin.json in a Claude-only bundle', async () => {
    writeSkill(src, 'api-design');
    await sync(root, { config: config(['claude-marketplace']), silent: true });
    const handWritten = join(root, 'plugins', name, 'plugin.json');
    writeFileSync(handWritten, JSON.stringify({ $schema: pluginSchema.$id, name }));

    await sync(root, { config: config(['claude-marketplace']), silent: true, prune: true });
    expect(existsSync(handWritten)).toBe(true);
  });

  it('uninstall removes the bundles and the index', async () => {
    writeSkill(src, 'api-design');
    writeAgent(src, 'reviewer');
    writeConfig(root, config(['agent-plugins']));
    await sync(root, { silent: true });

    await uninstall(root);
    expect(existsSync(join(root, 'plugins'))).toBe(false);
    expect(existsSync(join(root, '.claude-plugin'))).toBe(false);
  });

  it('eject keeps the bundle but drops the now-stale lock', async () => {
    writeSkill(src, 'api-design');
    writeConfig(root, config(['agent-plugins']));
    await sync(root, { silent: true });

    await eject(root);
    const pluginDir = join(root, 'plugins', name);
    expect(existsSync(join(pluginDir, 'plugin.json'))).toBe(true);
    expect(readFileSync(join(pluginDir, 'skills', 'api-design', 'SKILL.md'), 'utf8')).not.toContain(
      'Generated by bluetemberg',
    );
    expect(existsSync(join(pluginDir, 'digital.prototyp.bluetemberg'))).toBe(false);
  });

  it('why names the bundle paths an item is written to', () => {
    writeSkill(src, 'api-design');
    writeAgent(src, 'reviewer');
    writeConfig(root, config(['agent-plugins']));

    const skill = buildWhyReport(root, 'api-design');
    expect(skill.matches[0]?.outputs).toContain(`plugins/${name}/skills/api-design/SKILL.md`);

    const agent = buildWhyReport(root, `plugins/${name}/com.github.copilot/agents/reviewer.agent.md`);
    expect(agent.matchedAs).toBe('output');
    expect(agent.platforms).toEqual(['agent-plugins']);
    expect(agent.matches[0]?.id).toBe('reviewer');
  });
});
