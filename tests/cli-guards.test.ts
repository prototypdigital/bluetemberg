import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { findReservedFlagCollisions, formatReservedFlagCollisions } from '../src/cli-guards.js';

function programWithGlobals(): Command {
  const program = new Command();
  program.name('bluetemberg').version('1.0.0');
  return program;
}

describe('findReservedFlagCollisions', () => {
  it('returns nothing for a program whose subcommands avoid reserved flags', () => {
    const program = programWithGlobals();
    program.command('add').argument('<packages...>').option('--silent');
    program.command('sync').option('--check');

    expect(findReservedFlagCollisions(program)).toEqual([]);
  });

  it('detects a subcommand option that reuses the long --version flag', () => {
    const program = programWithGlobals();
    program.command('add').option('--version <range>', 'shadowed by global --version');

    expect(findReservedFlagCollisions(program)).toEqual([{ command: 'add', flag: '--version' }]);
  });

  it.each([
    ['-V', '-V <range>'],
    ['--help', '--help <topic>'],
    ['-h', '-h <topic>'],
  ])('detects the reserved flag %s', (flag, flags) => {
    const program = programWithGlobals();
    program.command('thing').option(flags, 'collides');

    expect(findReservedFlagCollisions(program)).toEqual([{ command: 'thing', flag }]);
  });

  it('walks nested subcommands and reports the full command path', () => {
    const program = programWithGlobals();
    const source = program.command('source');
    source.command('search').option('--version <range>', 'collides');

    expect(findReservedFlagCollisions(program)).toEqual([{ command: 'source search', flag: '--version' }]);
  });
});

describe('formatReservedFlagCollisions', () => {
  it('names each offending command and flag', () => {
    const message = formatReservedFlagCollisions([
      { command: 'add', flag: '--version' },
      { command: 'source search', flag: '--version' },
    ]);

    expect(message).toContain('"add" defines --version');
    expect(message).toContain('"source search" defines --version');
    expect(message).toMatch(/silently ignored/i);
  });
});
