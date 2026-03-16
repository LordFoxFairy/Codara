import {describe, expect, it, mock} from 'bun:test';
import {modelCommand} from '@capability/command/builtin/model';
import type {CodaraCommandContext, ParsedCodaraCommand} from '@capability/command/types';

function makeContext(overrides: {
  args?: string[];
  modelAlias?: string;
  modelAliases?: string[];
  onModelSwitch?: (alias: string) => Promise<void> | void;
} = {}): CodaraCommandContext {
  const command: ParsedCodaraCommand = {
    raw: `/model ${(overrides.args ?? []).join(' ')}`.trim(),
    name: 'model',
    args: overrides.args ?? [],
    argsText: (overrides.args ?? []).join(' '),
  };

  return {
    command,
    registry: [],
    agent: {} as CodaraCommandContext['agent'],
    environment: {
      modelAlias: overrides.modelAlias,
      modelAliases: overrides.modelAliases,
      onModelSwitch: overrides.onModelSwitch,
    },
  };
}

describe('/model command', () => {
  describe('list mode (no args)', () => {
    it('shows "no aliases" when none configured', async () => {
      const result = await modelCommand.execute(makeContext());
      expect(result.ok).toBe(true);
      expect(result.output).toContain('No model aliases configured');
    });

    it('lists aliases and marks active', async () => {
      const result = await modelCommand.execute(makeContext({
        modelAlias: 'sonnet',
        modelAliases: ['sonnet', 'opus', 'haiku'],
      }));
      expect(result.ok).toBe(true);
      expect(result.output).toContain('* sonnet (active)');
      expect(result.output).toContain('opus');
      expect(result.output).toContain('haiku');
    });
  });

  describe('switch mode (with alias arg)', () => {
    it('rejects unknown alias', async () => {
      const result = await modelCommand.execute(makeContext({
        args: ['unknown'],
        modelAliases: ['sonnet', 'opus'],
      }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('Unknown model alias');
      expect(result.output).toContain('sonnet, opus');
    });

    it('returns error when onModelSwitch not provided', async () => {
      const result = await modelCommand.execute(makeContext({
        args: ['sonnet'],
        modelAliases: ['sonnet'],
      }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('not supported');
    });

    it('calls onModelSwitch and confirms', async () => {
      const switchFn = mock(() => Promise.resolve());
      const result = await modelCommand.execute(makeContext({
        args: ['opus'],
        modelAliases: ['sonnet', 'opus'],
        onModelSwitch: switchFn,
      }));
      expect(result.ok).toBe(true);
      expect(result.output).toContain('Switched to model "opus"');
      expect(switchFn).toHaveBeenCalledWith('opus');
    });

    it('handles switch error gracefully', async () => {
      const switchFn = mock(() => { throw new Error('API key missing'); });
      const result = await modelCommand.execute(makeContext({
        args: ['opus'],
        modelAliases: ['sonnet', 'opus'],
        onModelSwitch: switchFn,
      }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('Failed to switch model');
      expect(result.output).toContain('API key missing');
    });
  });
});
