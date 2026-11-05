import { describe, expect, it } from 'vitest';

import { getMachineReadableHelp } from '../src/help-json.js';

interface HelpOption {
  long: string;
}

interface HelpCommand {
  name: string;
  options?: HelpOption[];
}

function optionNames(command: HelpCommand | undefined): string[] {
  return (command?.options ?? []).map((o) => o.long);
}

describe('machine-readable help', () => {
  const help = getMachineReadableHelp();

  it('lists every lockfile stacks detection reads', () => {
    const stacks = help.stacks as { detection: { layers: string[] } };
    const lockfileLayer = stacks.detection.layers.find((l) => l.startsWith('lockfile'));

    expect(lockfileLayer).toContain('package-lock.json');
    expect(lockfileLayer).toContain('pnpm-lock.yaml');
    expect(lockfileLayer).toContain('yarn.lock');
  });

  it.each(['add', 'install', 'update'])('documents --skip-scan on source %s', (name) => {
    const source = help.source as { commands: HelpCommand[] };
    const command = source.commands.find((c) => c.name === name);

    expect(optionNames(command)).toContain('--skip-scan');
  });
});
