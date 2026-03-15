import {describe, expect, it} from 'bun:test';
import {filterCommands, mapCommandSpecs, matchCommandPrefix, type CompletionItem} from '../../../src/cli/hooks/use-command-completion';
import type {CodaraCommandSpec} from '@capability/command/types';

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

  it('returns all commands for empty prefix', () => {
    expect(filterCommands(commands, '')).toHaveLength(5);
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

  it('limits to 8 results', () => {
    const many: CompletionItem[] = Array.from({length: 20}, (_, i) => ({
      name: `cmd-${i}`,
      description: `Command ${i}`,
      sourceLabel: 'builtin',
    }));
    expect(filterCommands(many, '').length).toBeLessThanOrEqual(8);
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
