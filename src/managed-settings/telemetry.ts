import { createHash } from 'node:crypto';
import type { ManagedSettingsHost } from './hosts.js';

/**
 * Opt-in OpenTelemetry export for the managed-settings policy files, as checked against the hosts'
 * own docs on 2026-11-04. A repository can't turn this on: Claude Code ignores the exporter and
 * content variables in a project's `.claude/settings.json`, so org policy is the only place
 * bluetemberg can write it. Bluetemberg itself sends nothing: these keys point each host's own
 * exporter at the org's collector, keep every content-capture class off, and add attribution.
 *
 * - Claude Code: `env` variables. Managed `env` merges per variable across sources, so our
 *   `OTEL_RESOURCE_ATTRIBUTES` replaces any other source's value for that variable.
 * - GitHub Copilot: a `telemetry` object. The highest-precedence managed source supplies the whole
 *   object; lower sources are not merged in. OTLP over HTTP only.
 */
export const TELEMETRY_PROTOCOLS = ['http/protobuf', 'http/json', 'grpc'] as const;
export type TelemetryProtocol = (typeof TELEMETRY_PROTOCOLS)[number];

/** Hosts whose exporters speak only OTLP over HTTP. */
const HTTP_ONLY_HOSTS: readonly ManagedSettingsHost[] = ['copilot'];

/** Our attribute namespace. Admin-supplied keys may not use it, so attribution can't be spoofed. */
export const ATTRIBUTE_PREFIX = 'bluetemberg.';

/** Hex characters of the pack-set digest: enough to tell builds apart, short enough for a label. */
const DIGEST_HEX_LENGTH = 16;

/** A conservative OTel attribute key: dotted ASCII words. */
const ATTRIBUTE_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** Keys that suggest a credential. Policy files are readable by everyone on the machine. */
const SECRET_KEY_RE = /secret|token|passw|authorization|api[_.-]?key|credential|private/i;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface TelemetryOptions {
  /** OTLP collector base URL. Setting it is the opt-in. */
  endpoint: string;
  /** Default `http/protobuf`, which every supported host accepts. */
  protocol?: string;
  /** Extra resource attributes as `key=value`, kept alongside ours. */
  attributes?: string[];
}

export interface TelemetryPlan {
  endpoint: string;
  protocol: TelemetryProtocol;
  /** Every resource attribute written, ours first, unencoded. */
  attributes: Record<string, string>;
  /** `sha256:<hex>` over the pack set the bundles were built from; absent with no packs. */
  packsDigest?: string;
}

export interface TelemetryInputs {
  hosts: ManagedSettingsHost[];
  marketplace: string;
  ref?: string;
  packs: Record<string, { version: string; integrity: string }>;
  hostLabel: (host: ManagedSettingsHost) => string;
}

export function planTelemetry(
  options: TelemetryOptions,
  inputs: TelemetryInputs,
): { telemetry: TelemetryPlan; warnings: string[] } {
  const { endpoint, warnings } = validateEndpoint(options.endpoint);
  const protocol = validateProtocol(options.protocol ?? 'http/protobuf', inputs);
  const packsDigest = digestPacks(inputs.packs);
  const attributes: Record<string, string> = {
    'bluetemberg.marketplace': inputs.marketplace,
    ...(inputs.ref ? { 'bluetemberg.marketplace.ref': inputs.ref } : {}),
    ...(packsDigest ? { 'bluetemberg.packs.digest': packsDigest } : {}),
    ...parseAttributes(options.attributes ?? []),
  };
  return {
    telemetry: { endpoint, protocol, attributes, ...(packsDigest ? { packsDigest } : {}) },
    warnings,
  };
}

function validateEndpoint(raw: string): { endpoint: string; warnings: string[] } {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`--telemetry-endpoint "${raw}" is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`--telemetry-endpoint must be an http(s) URL, not ${url.protocol}`);
  }
  // A token in the URL would sit in a policy file every user on the machine can read.
  if (url.username || url.password) {
    throw new Error(
      '--telemetry-endpoint must not carry credentials. Authenticate with the host header helpers instead (see the generated README).',
    );
  }
  if (url.search || url.hash || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('--telemetry-endpoint must not have a query string or fragment.');
  }
  const warnings =
    url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)
      ? [
          `--telemetry-endpoint ${url.origin} is plain http: telemetry crosses the network unencrypted. Use https outside a local collector.`,
        ]
      : [];
  // The hosts append `/v1/<signal>` themselves, so drop a trailing slash to avoid `//v1/...`.
  return { endpoint: trimmed.replace(/\/+$/, ''), warnings };
}

function isProtocol(value: string): value is TelemetryProtocol {
  return (TELEMETRY_PROTOCOLS as readonly string[]).includes(value);
}

function validateProtocol(protocol: string, inputs: TelemetryInputs): TelemetryProtocol {
  if (!isProtocol(protocol)) {
    throw new Error(`--telemetry-protocol must be one of ${TELEMETRY_PROTOCOLS.join(', ')}.`);
  }
  if (protocol !== 'grpc') return protocol;
  const httpOnly = inputs.hosts.filter((h) => HTTP_ONLY_HOSTS.includes(h)).map(inputs.hostLabel);
  if (httpOnly.length === 0) return protocol;
  throw new Error(
    `--telemetry-protocol grpc is not supported by ${httpOnly.join(' and ')}, which exports OTLP over HTTP only. Use http/protobuf, or pass --host claude.`,
  );
}

function parseAttribute(spec: string): [string, string] {
  const eq = spec.indexOf('=');
  const key = eq > 0 ? spec.slice(0, eq).trim() : '';
  const value = eq > 0 ? spec.slice(eq + 1).trim() : '';
  if (!key || !value) throw new Error(`--telemetry-attribute "${spec}" is not key=value.`);
  if (!ATTRIBUTE_KEY_RE.test(key)) {
    throw new Error(`--telemetry-attribute key "${key}" must be ASCII letters, digits, ".", "_" or "-".`);
  }
  if (key.toLowerCase().startsWith(ATTRIBUTE_PREFIX)) {
    throw new Error(`--telemetry-attribute key "${key}" uses the reserved "${ATTRIBUTE_PREFIX}" prefix.`);
  }
  if (SECRET_KEY_RE.test(key)) {
    throw new Error(
      `--telemetry-attribute "${key}" looks like a credential. Resource attributes are labels on every datapoint and sit in a policy file every user can read.`,
    );
  }
  return [key, value];
}

function parseAttributes(specs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const [key, value] = parseAttribute(spec);
    if (Object.hasOwn(out, key)) throw new Error(`--telemetry-attribute "${key}" is given twice.`);
    out[key] = value;
  }
  return out;
}

/** Stable across machines: sorted by pack name, one `name@version integrity` line each. */
export function digestPacks(
  packs: Record<string, { version: string; integrity: string }>,
): string | undefined {
  const names = Object.keys(packs).sort();
  if (names.length === 0) return undefined;
  const lines = names.map((n) => `${n}@${packs[n].version} ${packs[n].integrity}\n`).join('');
  return `sha256:${createHash('sha256').update(lines).digest('hex').slice(0, DIGEST_HEX_LENGTH)}`;
}

/**
 * `OTEL_RESOURCE_ATTRIBUTES` allows no whitespace, `"`, `,`, `;` or `\`; values are percent-encoded
 * so a scoped pack name or an admin's free text can't break the list.
 */
export function encodeResourceAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(',');
}

/** Content-capture switches, each forced off so no local setting can turn one on. */
const CLAUDE_CONTENT_OFF = {
  OTEL_LOG_USER_PROMPTS: '0',
  OTEL_LOG_ASSISTANT_RESPONSES: '0',
  OTEL_LOG_TOOL_DETAILS: '0',
  OTEL_LOG_TOOL_CONTENT: '0',
} as const;

/** The Claude Code `env` block: metrics and events over OTLP, traces off, content off. */
export function claudeTelemetryEnv(telemetry: TelemetryPlan): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_TRACES_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: telemetry.protocol,
    OTEL_EXPORTER_OTLP_ENDPOINT: telemetry.endpoint,
    OTEL_RESOURCE_ATTRIBUTES: encodeResourceAttributes(telemetry.attributes),
    ...CLAUDE_CONTENT_OFF,
  };
}

/** The Copilot `telemetry` object: every capture class off, and locked against local settings. */
export function copilotTelemetry(telemetry: TelemetryPlan): Record<string, unknown> {
  return {
    enabled: true,
    endpoint: telemetry.endpoint,
    protocol: telemetry.protocol,
    resourceAttributes: { ...telemetry.attributes },
    capture: {
      identity: false,
      prompts: false,
      responses: false,
      toolArguments: false,
      toolOutput: false,
      policyDetail: false,
    },
    lockCaptureContent: true,
  };
}
