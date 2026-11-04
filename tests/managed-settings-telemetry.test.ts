import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planManagedSettings, type ManagedSettingsPlan } from '../src/managed-settings/index.js';
import { digestPacks, encodeResourceAttributes } from '../src/managed-settings/telemetry.js';
import { getMachineReadableHelp } from '../src/help-json.js';

const PACK = '@acme/rules-frontend';
const LOCKED = { version: '1.2.0', resolved: 'https://registry.example/x.tgz', integrity: 'sha512-aaa' };
const ENDPOINT = 'https://otel.example.com';

let root: string;

function write(rel: string, value: unknown): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function fixture(platforms = ['claude', 'claude-marketplace', 'agent-plugins']): void {
  write('bluetemberg.config.json', {
    platforms,
    source: 'llm',
    targets: {},
    marketplace: { remote: 'acme/ai-marketplace', plugins: [{ name: 'frontend' }] },
  });
  write('.claude-plugin/marketplace.json', {
    name: 'proj',
    owner: { name: 'acme' },
    plugins: [{ name: 'frontend', description: '', source: './plugins/frontend' }],
  });
  write('llm/packages-lock.json', { lockfileVersion: 1, packages: { [PACK]: LOCKED } });
  write('plugins/frontend/digital.prototyp.bluetemberg/bundle-lock.json', {
    lockfileVersion: 1,
    generator: 'bluetemberg',
    packs: { [PACK]: { version: LOCKED.version, integrity: LOCKED.integrity } },
    files: {},
  });
}

function settingsFor(plan: ManagedSettingsPlan, host: 'claude' | 'copilot'): Record<string, unknown> {
  const file = plan.files.find((f) => f.host === host);
  if (!file) throw new Error(`no ${host} file`);
  return JSON.parse(file.content) as Record<string, unknown>;
}

function readme(plan: ManagedSettingsPlan): string {
  return plan.files.find((f) => f.path === 'README.md')?.content ?? '';
}

const DIGEST = digestPacks({ [PACK]: { version: LOCKED.version, integrity: LOCKED.integrity } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bluetemberg-telemetry-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('managed-settings telemetry', () => {
  it('writes no telemetry keys unless asked', () => {
    fixture();
    const plan = planManagedSettings(root);
    expect(plan.telemetry).toBeNull();
    expect(settingsFor(plan, 'claude')).not.toHaveProperty('env');
    expect(settingsFor(plan, 'copilot')).not.toHaveProperty('telemetry');
    for (const file of plan.files) expect(file.content).not.toMatch(/OTEL|telemetry export:\*\* on/i);
    expect(readme(plan)).toContain('**Telemetry export:** off');
  });

  it('points Claude Code at the collector with content capture locked off and traces off', () => {
    fixture();
    const plan = planManagedSettings(root, { telemetry: { endpoint: `${ENDPOINT}/` } });
    expect(settingsFor(plan, 'claude').env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_RESOURCE_ATTRIBUTES: `bluetemberg.marketplace=proj,bluetemberg.packs.digest=${encodeURIComponent(DIGEST ?? '')}`,
      OTEL_LOG_USER_PROMPTS: '0',
      OTEL_LOG_ASSISTANT_RESPONSES: '0',
      OTEL_LOG_TOOL_DETAILS: '0',
      OTEL_LOG_TOOL_CONTENT: '0',
    });
  });

  it('writes the Copilot telemetry object with every capture class off and locked', () => {
    fixture();
    const plan = planManagedSettings(root, { telemetry: { endpoint: ENDPOINT } });
    expect(settingsFor(plan, 'copilot').telemetry).toEqual({
      enabled: true,
      endpoint: ENDPOINT,
      protocol: 'http/protobuf',
      resourceAttributes: { 'bluetemberg.marketplace': 'proj', 'bluetemberg.packs.digest': DIGEST },
      capture: {
        identity: false,
        prompts: false,
        responses: false,
        toolArguments: false,
        toolOutput: false,
        policyDetail: false,
      },
      lockCaptureContent: true,
    });
    expect(settingsFor(plan, 'copilot')).not.toHaveProperty('env');
  });

  it('attributes the ref and admin attributes, percent-encoding values for the env form', () => {
    fixture();
    const plan = planManagedSettings(root, {
      ref: 'v1.4.0',
      telemetry: { endpoint: ENDPOINT, attributes: ['team.id=platform', 'org.name=Acme, Inc'] },
    });
    expect(plan.telemetry?.attributes).toEqual({
      'bluetemberg.marketplace': 'proj',
      'bluetemberg.marketplace.ref': 'v1.4.0',
      'bluetemberg.packs.digest': DIGEST,
      'team.id': 'platform',
      'org.name': 'Acme, Inc',
    });
    const attrs = (settingsFor(plan, 'claude').env as Record<string, string>).OTEL_RESOURCE_ATTRIBUTES;
    expect(attrs).toContain('org.name=Acme%2C%20Inc');
    expect(attrs).not.toMatch(/[\s";\\]/);
    expect(attrs.split(',')).toHaveLength(5);
  });

  it('keeps the digest stable and sensitive to pack versions', () => {
    const a = digestPacks({
      b: { version: '1.0.0', integrity: 'x' },
      a: { version: '2.0.0', integrity: 'y' },
    });
    const b = digestPacks({
      a: { version: '2.0.0', integrity: 'y' },
      b: { version: '1.0.0', integrity: 'x' },
    });
    const c = digestPacks({
      a: { version: '2.0.1', integrity: 'y' },
      b: { version: '1.0.0', integrity: 'x' },
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(digestPacks({})).toBeUndefined();
    expect(encodeResourceAttributes({ 'a.b': 'x y,z;"\\', c: '@acme/pkg' })).toBe(
      'a.b=x%20y%2Cz%3B%22%5C,c=%40acme%2Fpkg',
    );
  });

  it('refuses endpoints that could carry a credential', () => {
    fixture();
    const bad = [
      'https://user:pass@otel.example.com',
      'https://otel.example.com?token=abc',
      'https://otel.example.com/#x',
      'ftp://otel.example.com',
      'otel.example.com',
    ];
    for (const endpoint of bad) {
      expect(() => planManagedSettings(root, { telemetry: { endpoint } }), endpoint).toThrow(
        /--telemetry-endpoint/,
      );
    }
  });

  it('warns on plain http to a remote host, not to a local collector', () => {
    fixture();
    const remote = planManagedSettings(root, { telemetry: { endpoint: 'http://otel.example.com:4318' } });
    expect(remote.warnings.join('\n')).toMatch(/plain http/);
    const local = planManagedSettings(root, { telemetry: { endpoint: 'http://localhost:4318' } });
    expect(local.warnings.join('\n')).not.toMatch(/plain http/);
  });

  it('refuses grpc for Copilot but allows it for Claude Code alone', () => {
    fixture();
    expect(() => planManagedSettings(root, { telemetry: { endpoint: ENDPOINT, protocol: 'grpc' } })).toThrow(
      /GitHub Copilot, which exports OTLP over HTTP only/,
    );
    const plan = planManagedSettings(root, {
      host: 'claude',
      telemetry: { endpoint: ENDPOINT, protocol: 'grpc' },
    });
    expect((settingsFor(plan, 'claude').env as Record<string, string>).OTEL_EXPORTER_OTLP_PROTOCOL).toBe(
      'grpc',
    );
    expect(() => planManagedSettings(root, { telemetry: { endpoint: ENDPOINT, protocol: 'udp' } })).toThrow(
      /must be one of/,
    );
  });

  it('refuses reserved, malformed, duplicate and credential-like attributes', () => {
    fixture();
    const cases: [string[], RegExp][] = [
      [['bluetemberg.packs.digest=forged'], /reserved/],
      [['Bluetemberg.marketplace=x'], /reserved/],
      [['noequals'], /not key=value/],
      [['team.id='], /not key=value/],
      [['bad key=x'], /must be ASCII/],
      [['team.id=a', 'team.id=b'], /given twice/],
      [['api_key=abc'], /looks like a credential/],
      [['otlp.token=abc'], /looks like a credential/],
    ];
    for (const [attributes, error] of cases) {
      expect(() => planManagedSettings(root, { telemetry: { endpoint: ENDPOINT, attributes } })).toThrow(
        error,
      );
    }
  });

  it('says in the README what is sent and where, and writes no header or credential', () => {
    fixture();
    const plan = planManagedSettings(root, { telemetry: { endpoint: ENDPOINT } });
    const text = readme(plan);
    expect(text).toContain('## What is sent, and where');
    expect(text).toContain(`**\`${ENDPOINT}\`**`);
    expect(text).toContain('user.email');
    expect(text).toContain('otelHeadersHelper');
    expect(text).toContain(`| \`bluetemberg.packs.digest\` | \`${DIGEST}\` |`);
    for (const file of plan.files.filter((f) => f.host)) {
      expect(file.content).not.toMatch(/HEADERS|"headers"|headersProvider|otelHeadersHelper/);
    }
  });

  it('lists the telemetry flags in --help --json', () => {
    const help = getMachineReadableHelp() as { managedSettings: { options: { long: string }[] } };
    const flags = help.managedSettings.options.map((o) => o.long.split(' ')[0]);
    expect(flags).toEqual(
      expect.arrayContaining(['--telemetry-endpoint', '--telemetry-protocol', '--telemetry-attribute']),
    );
  });
});
