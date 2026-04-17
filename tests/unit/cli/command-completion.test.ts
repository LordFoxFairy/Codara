import {describe, expect, it} from 'bun:test';
import {filterCommands, mapCommandSpecs, matchCommandPrefix, type CompletionItem} from '../../../src/cli/features/composer/use-completion';
import type {CodaraCommandSpec} from '@commands/runtime/types';

describe('matchCommandPrefix', () => {
  it('matches / at start', () => {
    expect(matchCommandPrefix('/')).toBe('');
  });

  it('matches /hel prefix', () => {
    expect(matchCommandPrefix('/hel')).toBe('hel');
  });

  it('matches /memory', () => {
    expect(matchCommandPrefix('/memory')).toBe('memory');
  });

  it('returns undefined for empty text', () => {
    expect(matchCommandPrefix('')).toBeUndefined();
  });

  it('returns undefined for non-slash text', () => {
    expect(matchCommandPrefix('hello')).toBeUndefined();
  });

  it('returns undefined for text with space after slash command', () => {
    expect(matchCommandPrefix('/help me')).toBeUndefined();
  });

  it('returns undefined for slash in the middle', () => {
    expect(matchCommandPrefix('say /hello')).toBeUndefined();
  });
});

describe('filterCommands', () => {
  const commands: CompletionItem[] = [
    {name: 'help', description: 'Show help', sourceLabel: 'builtin'},
    {name: 'memory', description: 'Memory commands', sourceLabel: 'builtin'},
    {name: 'status', description: 'Session status', sourceLabel: 'builtin'},
    {name: 'brainstorm', description: 'Brainstorm ideas', sourceLabel: 'superpowers'},
    {name: 'debug', description: 'Debug systematically', sourceLabel: 'superpowers'},
  ];

  it('returns only builtin commands for empty prefix', () => {
    const result = filterCommands(commands, '');
    expect(result).toHaveLength(3);
    expect(result.every(cmd => cmd.sourceLabel === 'builtin')).toBe(true);
  });

  it('returns all matching commands (including skills) when prefix is provided', () => {
    // Prefix search covers both builtin and skill commands
    const result = filterCommands(commands, 'brain');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('brainstorm');
    expect(result[0]!.sourceLabel).toBe('superpowers');
  });

  it('filters by prefix', () => {
    const result = filterCommands(commands, 'mem');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('memory');
  });

  it('is case-insensitive', () => {
    expect(filterCommands(commands, 'HELP')).toHaveLength(1);
  });

  it('matches substring', () => {
    const result = filterCommands(commands, 'brain');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('brainstorm');
  });

  it('returns empty for no match', () => {
    expect(filterCommands(commands, 'xyz')).toHaveLength(0);
  });

  it('limits to MAX_VISIBLE_ITEMS results', () => {
    const many: CompletionItem[] = Array.from({length: 30}, (_, i) => ({
      name: `cmd-${i}`,
      description: `Command ${i}`,
      sourceLabel: 'builtin',
    }));
    expect(filterCommands(many, '').length).toBeLessThanOrEqual(20);
  });
});

describe('mapCommandSpecs', () => {
  it('maps builtin source', () => {
    const specs: CodaraCommandSpec[] = [{
      name: 'help',
      description: 'Show help',
      usage: '/help',
      source: {type: 'builtin'},
    }];

    const result = mapCommandSpecs(specs);
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceLabel).toBe('builtin');
  });

  it('maps skill source with name', () => {
    const specs: CodaraCommandSpec[] = [{
      name: 'brainstorm',
      description: 'Brainstorm',
      usage: '/brainstorm',
      source: {type: 'skill', skillName: 'superpowers', skillPath: '/tmp/skill'},
    }];

    const result = mapCommandSpecs(specs);
    expect(result[0]!.sourceLabel).toBe('superpowers');
  });
});
