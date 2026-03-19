import {describe, expect, it} from 'bun:test';
import {
  acceptCompletionText,
  extractFirstArgumentSuggestions,
  filterArgumentSuggestions,
  filterCommands,
  mapCommandItems,
  mapCommandSpecs,
  matchCommandPrefix,
  resolveCommandCompletionMatch,
  resolveCommandHint,
  type CompletionItem,
} from '../../../src/cli/hooks/use-command-completion';
import type {CodaraCommandSpec} from '@capability/command/runtime/types';

const SPECS: CodaraCommandSpec[] = [
  {
    name: 'help',
    description: 'Show help',
    usage: '/help [command|page]',
    source: {type: 'builtin'},
  },
  {
    name: 'memory',
    description: 'Memory commands',
    usage: '/memory [show|project|user|global]',
    source: {type: 'builtin'},
  },
  {
    name: 'team',
    description: 'Manage teams',
    usage: '/team <create|list|status|enter|leave|message>',
    aliases: ['t'],
    source: {type: 'builtin'},
  },
  {
    name: 'brainstorm',
    description: 'Brainstorm ideas',
    usage: '/brainstorm',
    source: {type: 'skill', skillName: 'superpowers', skillPath: '/tmp/skill'},
  },
];

describe('matchCommandPrefix', () => {
  it('matches bare slash command names', () => {
    expect(matchCommandPrefix('/')).toBe('');
    expect(matchCommandPrefix('/hel')).toBe('hel');
    expect(matchCommandPrefix('/memory')).toBe('memory');
  });

  it('returns undefined once the user has moved into arguments', () => {
    expect(matchCommandPrefix('/help me')).toBeUndefined();
    expect(matchCommandPrefix('hello')).toBeUndefined();
    expect(matchCommandPrefix('say /hello')).toBeUndefined();
  });
});

describe('resolveCommandCompletionMatch', () => {
  const commands = mapCommandSpecs(SPECS);

  it('stays in command-name mode before the first space', () => {
    expect(resolveCommandCompletionMatch('/te', commands)).toEqual({
      kind: 'command-name',
      prefix: 'te',
    });
  });

  it('switches to argument mode after a known command and space', () => {
    const match = resolveCommandCompletionMatch('/team ', commands);
    expect(match?.kind).toBe('argument');
    if (match?.kind === 'argument') {
      expect(match.command.name).toBe('team');
      expect(match.argPrefix).toBe('');
    }
  });

  it('accepts aliases when entering argument mode', () => {
    const match = resolveCommandCompletionMatch('/t ', commands);
    expect(match?.kind).toBe('argument');
    if (match?.kind === 'argument') {
      expect(match.command.name).toBe('team');
    }
  });

  it('keeps the current first-argument prefix while typing it', () => {
    const match = resolveCommandCompletionMatch('/memory pro', commands);
    expect(match?.kind).toBe('argument');
    if (match?.kind === 'argument') {
      expect(match.argPrefix).toBe('pro');
    }
  });

  it('stops offering argument suggestions after the first argument is complete', () => {
    expect(resolveCommandCompletionMatch('/team status now', commands)).toBeUndefined();
  });
});

describe('filterCommands', () => {
  const commands = mapCommandItems(mapCommandSpecs(SPECS));

  it('returns only builtin commands for empty prefix', () => {
    const result = filterCommands(commands, '');
    expect(result).toHaveLength(3);
    expect(result.every((item) => item.sourceLabel === 'builtin')).toBe(true);
  });

  it('includes skill commands when a real prefix is present', () => {
    const result = filterCommands(commands, 'brain');
    expect(result).toHaveLength(1);
    expect(result[0]!.value).toBe('brainstorm');
    expect(result[0]!.sourceLabel).toBe('superpowers');
  });

  it('ranks exact and alias matches ahead of weaker substring matches', () => {
    const result = filterCommands(commands, 't');
    expect(result[0]!.value).toBe('team');
  });
});

describe('extractFirstArgumentSuggestions', () => {
  const commands = mapCommandSpecs(SPECS);

  it('extracts explicit choices from usage variants', () => {
    const team = commands.find((item) => item.name === 'team')!;
    const memory = commands.find((item) => item.name === 'memory')!;

    expect(extractFirstArgumentSuggestions(team)).toEqual(['create', 'list', 'status', 'enter', 'leave', 'message']);
    expect(extractFirstArgumentSuggestions(memory)).toEqual(['show', 'project', 'user', 'global']);
  });

  it('skips single placeholders that are not real suggestions', () => {
    const resume = mapCommandSpecs([{
      name: 'resume',
      description: 'Resume a session',
      usage: '/resume [sessionId]',
      source: {type: 'builtin'},
    }])[0]!;

    expect(extractFirstArgumentSuggestions(resume)).toEqual([]);
  });
});

describe('filterArgumentSuggestions', () => {
  const command = mapCommandSpecs(SPECS).find((item) => item.name === 'memory')!;

  it('filters choices by the current first-argument prefix', () => {
    const result = filterArgumentSuggestions(
      extractFirstArgumentSuggestions(command),
      'pro',
      command,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('argument');
    expect(result[0]!.label).toBe('project');
  });
});

describe('resolveCommandHint', () => {
  const commands = mapCommandSpecs(SPECS);
  const items = mapCommandItems(commands);

  it('returns a hint for exact commands even without an active list', () => {
    expect(resolveCommandHint('/team status now', commands)).toEqual({
      title: 'Usage',
      label: '/team',
      description: 'Manage teams',
      sourceLabel: 'builtin',
      usage: '/team <create|list|status|enter|leave|message>',
      aliases: ['t'],
    });
  });

  it('builds the hint from the selected completion item when available', () => {
    expect(resolveCommandHint('/te', commands, items.find((item) => item.commandName === 'team'))).toEqual({
      title: 'Command',
      label: '/team',
      description: 'Manage teams',
      sourceLabel: 'builtin',
      usage: '/team <create|list|status|enter|leave|message>',
      aliases: ['t'],
    });
  });
});

describe('acceptCompletionText', () => {
  const commandItems = mapCommandItems(mapCommandSpecs(SPECS));
  const help = commandItems.find((item) => item.commandName === 'help')!;
  const team = commandItems.find((item) => item.commandName === 'team')!;
  const argumentItem: CompletionItem = {
    kind: 'argument',
    value: 'status',
    label: 'status',
    description: 'Manage teams',
    sourceLabel: 'builtin',
    usage: '/team <create|list|status|enter|leave|message>',
    commandName: 'team',
    aliases: ['t'],
  };

  it('accepts a bare command and appends a space when more arguments are expected', () => {
    expect(acceptCompletionText('/he', help)).toBe('/help ');
    expect(acceptCompletionText('/te', team)).toBe('/team ');
  });

  it('normalizes alias-based selection back to the canonical command', () => {
    expect(acceptCompletionText('/t', team)).toBe('/team ');
  });

  it('replaces the first argument token instead of executing immediately', () => {
    expect(acceptCompletionText('/team st', argumentItem)).toBe('/team status');
  });
});

describe('mapCommandSpecs', () => {
  it('maps builtin and skill source labels plus aliases', () => {
    const result = mapCommandSpecs(SPECS);
    expect(result[0]!.sourceLabel).toBe('builtin');
    expect(result[2]!.aliases).toEqual(['t']);
    expect(result[3]!.sourceLabel).toBe('superpowers');
  });
});
