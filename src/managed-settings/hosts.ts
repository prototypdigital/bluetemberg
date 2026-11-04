import { AGENT_PLUGINS_PLATFORM, MARKETPLACE_PLATFORM, type Platform } from '../types.js';

/**
 * What each host documents about org policy files, as checked against the hosts' own docs on
 * 2026-11-04. Both hosts read the same top-level keys (`extraKnownMarketplaces`, `enabledPlugins`,
 * `strictKnownMarketplaces`, `allowedMcpServers`, `deniedMcpServers`), but the semantics differ in
 * places that matter here, so each host gets its own file:
 *
 * - Marketplace `ref`: Claude Code takes a branch or tag only; Copilot also takes a commit SHA.
 * - `strictKnownMarketplaces`: Claude Code needs a `skills-dir` entry to keep skills-directory
 *   plugins loading; Copilot has no such source type and turns off its built-in marketplaces.
 * - `allowedMcpServers` across sources: Claude Code merges them (union); Copilot intersects them.
 * - Neither host pins a plugin version: `enabledPlugins` maps `plugin@marketplace` to a Boolean.
 */
export type ManagedSettingsHost = 'claude' | 'copilot';

export const MANAGED_SETTINGS_HOSTS: readonly ManagedSettingsHost[] = ['claude', 'copilot'];

export interface HostFacts {
  id: ManagedSettingsHost;
  /** Human name used in the README and log lines. */
  label: string;
  /** Output subdirectory under `--out`. */
  dir: string;
  /** The bundle platform whose output this host installs from the marketplace. */
  bundlePlatform: Platform;
  /** System file locations, per OS, with the OS named as the host's docs name it. */
  filePaths: { os: string; path: string }[];
  /** Whether a marketplace `ref` may be a commit SHA. */
  refAcceptsSha: boolean;
  /** Official docs this file follows. */
  docs: { label: string; url: string }[];
}

export const HOST_FACTS: Record<ManagedSettingsHost, HostFacts> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    dir: 'claude-code',
    bundlePlatform: MARKETPLACE_PLATFORM,
    filePaths: [
      { os: 'macOS', path: '/Library/Application Support/ClaudeCode/managed-settings.json' },
      { os: 'Linux and WSL', path: '/etc/claude-code/managed-settings.json' },
      { os: 'Windows', path: 'C:\\Program Files\\ClaudeCode\\managed-settings.json' },
    ],
    refAcceptsSha: false,
    docs: [
      { label: 'Deploy managed settings', url: 'https://code.claude.com/docs/en/managed-settings' },
      { label: 'Settings reference', url: 'https://code.claude.com/docs/en/settings-reference' },
      {
        label: 'Marketplace sources',
        url: 'https://code.claude.com/docs/en/plugins/marketplace-reference',
      },
    ],
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    dir: 'github-copilot',
    bundlePlatform: AGENT_PLUGINS_PLATFORM,
    filePaths: [
      { os: 'macOS', path: '/Library/Application Support/GitHubCopilot/managed-settings.json' },
      { os: 'Linux', path: '/etc/github-copilot/managed-settings.json' },
      { os: 'Windows', path: '%ProgramFiles%\\GitHubCopilot\\managed-settings.json' },
    ],
    refAcceptsSha: true,
    docs: [
      {
        label: 'Enterprise managed settings reference',
        url: 'https://docs.github.com/en/copilot/reference/enterprise-managed-settings-reference',
      },
      {
        label: 'Choosing how to deploy enterprise-managed settings',
        url: 'https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/deploy-managed-settings',
      },
    ],
  },
};

/** The official Anthropic marketplace, which a Claude Code allowlist blocks unless it lists it. */
export const CLAUDE_OFFICIAL_MARKETPLACE = 'anthropics/claude-plugins-official';
