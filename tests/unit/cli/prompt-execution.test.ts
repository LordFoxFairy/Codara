import {describe, expect, it} from 'bun:test';
import {normalizeCliPrompt, resolveCliPromptMode, runCliPromptExecution} from '@/cli/app/prompt-execution';
import type {CliRunState} from '@/cli/app/view-state';

describe('CLI prompt execution helper', () => {
  it('normalizes prompt text and resolves slash vs agent mode', () => {
    expect(normalizeCliPrompt('  /help  ')).toBe('/help');
    expect(resolveCliPromptMode('/help')).toBe('slash-command');
    expect(resolveCliPromptMode('fix the bug')).toBe('agent-prompt');
  });

  it('skips blank prompts and locked executions', async () => {
    const calls: string[] = [];
    const resultBlank = await runCliPromptExecution({
      rawPrompt: '   ',
      isRunning: false,
      setRunState: () => calls.push('run-state'),
      clearRuntimeEvents: () => calls.push('runtime'),
      clearCommandOutput: () => calls.push('output'),
      clearActiveTurn: () => calls.push('active-turn'),
      runSlashCommand: async () => calls.push('slash'),
      runAgentPrompt: async () => calls.push('agent'),
      reportError: () => 'error',
      refreshCoreState: async () => undefined,
    });
    const resultLocked = await runCliPromptExecution({
      rawPrompt: 'hello',
      isRunning: true,
      setRunState: () => calls.push('run-state'),
      clearRuntimeEvents: () => calls.push('runtime'),
      clearCommandOutput: () => calls.push('output'),
      clearActiveTurn: () => calls.push('active-turn'),
      runSlashCommand: async () => calls.push('slash'),
      runAgentPrompt: async () => calls.push('agent'),
      reportError: () => 'error',
      refreshCoreState: async () => undefined,
    });

    expect(resultBlank).toEqual({started: false});
    expect(resultLocked).toEqual({started: false});
    expect(calls).toEqual([]);
  });

  it('starts run state, clears UI state, and routes slash commands', async () => {
    const steps: string[] = [];
    const runStates: CliRunState[] = [];

    const result = await runCliPromptExecution({
      rawPrompt: ' /help ',
      isRunning: false,
      setRunState: (state) => runStates.push(state),
      clearRuntimeEvents: () => steps.push('runtime'),
      clearCommandOutput: () => steps.push('output'),
      clearActiveTurn: () => steps.push('active-turn'),
      runSlashCommand: async (prompt) => steps.push(`slash:${prompt}`),
      runAgentPrompt: async (prompt) => steps.push(`agent:${prompt}`),
      reportError: () => 'error',
      refreshCoreState: async () => undefined,
    });

    expect(result).toEqual({
      started: true,
      prompt: '/help',
      mode: 'slash-command',
    });
    expect(runStates).toEqual([{status: 'running'}]);
    expect(steps).toEqual(['runtime', 'output', 'slash:/help']);
  });

  it('runs shared recovery when agent prompt execution throws', async () => {
    const steps: string[] = [];

    const result = await runCliPromptExecution({
      rawPrompt: 'fix it',
      isRunning: false,
      setRunState: () => steps.push('run-state'),
      clearRuntimeEvents: () => steps.push('runtime'),
      clearCommandOutput: () => steps.push('output'),
      clearActiveTurn: () => steps.push('active-turn'),
      runSlashCommand: async () => steps.push('slash'),
      runAgentPrompt: async () => {
        steps.push('agent');
        throw new Error('boom');
      },
      reportError: () => {
        steps.push('report-error');
        return 'boom';
      },
      refreshCoreState: async () => {
        steps.push('refresh');
      },
    });

    expect(result).toEqual({
      started: true,
      prompt: 'fix it',
      mode: 'agent-prompt',
    });
    expect(steps).toEqual(['run-state', 'runtime', 'output', 'agent', 'active-turn', 'report-error', 'refresh']);
  });
});
