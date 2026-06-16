import type { Command } from 'commander';

/**
 * Flags commander treats as global and silently inherits into every
 * subcommand: the version option added by `.version()` and the built-in help
 * option. A subcommand `.option()` that reuses one of these is shadowed by the
 * global handler and never fires — e.g. `add --version <range>` only ever
 * printed the CLI version. Hardcoded to commander's defaults, which this CLI
 * uses; update this set if the global version/help flags are ever customized.
 */
const RESERVED_FLAGS: ReadonlySet<string> = new Set(['-V', '--version', '-h', '--help']);

export interface ReservedFlagCollision {
  /** Space-joined command path, e.g. `source search`. */
  command: string;
  /** The colliding flag, e.g. `--version`. */
  flag: string;
}

/**
 * Walk the command tree under `root` and collect every subcommand option whose
 * short or long flag collides with a reserved global flag.
 */
export function findReservedFlagCollisions(root: Command): ReservedFlagCollision[] {
  const collisions: ReservedFlagCollision[] = [];

  const visit = (command: Command, path: readonly string[]): void => {
    for (const sub of command.commands) {
      const subPath = [...path, sub.name()];

      for (const option of sub.options) {
        for (const flag of [option.short, option.long]) {
          if (!flag || !RESERVED_FLAGS.has(flag)) continue;
          collisions.push({ command: subPath.join(' '), flag });
        }
      }

      visit(sub, subPath);
    }
  };

  visit(root, []);
  return collisions;
}

/** Format collisions into a single dev-facing error message. */
export function formatReservedFlagCollisions(collisions: readonly ReservedFlagCollision[]): string {
  const lines = collisions.map((c) => `  "${c.command}" defines ${c.flag}`);

  return [
    'CLI definition error: subcommand options collide with reserved global flags.',
    'Commander inherits --version/--help into every subcommand, so these options',
    'are silently ignored at runtime. Rename or remove them:',
    ...lines,
  ].join('\n');
}
