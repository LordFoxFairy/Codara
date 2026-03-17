import {describe, expect, test, mock} from 'bun:test';
import {AIMessage} from '@langchain/core/messages';
import {TeamBudgetTracker} from '@capability/team/budget/budget-tracker';
import {createTeamBudgetMiddleware} from '@capability/team/budget/team-budget-middleware';

describe('TeamBudgetMiddleware', () => {
  function makeContext(inputTokens: number, outputTokens: number) {
    return {
      response: new AIMessage({
        content: 'test',
        usage_metadata: {input_tokens: inputTokens, output_tokens: outputTokens} as never,
      }),
      state: {messages: []},
      systemMessage: [],
      execution: {} as never,
    } as never;
  }

  test('records usage to tracker after model call', async () => {
    const tracker = new TeamBudgetTracker();
    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
    });

    await mw.afterModel!(makeContext(1000, 200));

    const usage = tracker.getUsage();
    expect(usage.totalInputTokens).toBe(1000);
    expect(usage.totalOutputTokens).toBe(200);
    expect(usage.totalTokens).toBe(1200);
    expect(usage.byMember.get('m1')?.turns).toBe(1);
  });

  test('accumulates across multiple calls', async () => {
    const tracker = new TeamBudgetTracker();
    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
    });

    await mw.afterModel!(makeContext(500, 100));
    await mw.afterModel!(makeContext(300, 50));

    const usage = tracker.getUsage();
    expect(usage.totalTokens).toBe(950);
    expect(usage.byMember.get('m1')?.turns).toBe(2);
  });

  test('calls onBudgetAction when warning threshold reached', async () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 1000,
      onBudgetExceeded: 'pause',
    });
    const onAction = mock(() => {});

    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
      onBudgetAction: onAction,
    });

    // 950 / 1000 = 95% → warning
    await mw.afterModel!(makeContext(900, 50));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0].action).toBe('warning');
  });

  test('calls onBudgetAction when exceeded', async () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 500,
      onBudgetExceeded: 'shutdown',
    });
    const onAction = mock(() => {});

    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
      onBudgetAction: onAction,
    });

    await mw.afterModel!(makeContext(400, 200));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0].action).toBe('exceeded');
  });

  test('skips when no usage metadata', async () => {
    const tracker = new TeamBudgetTracker();
    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
    });

    const ctx = {
      response: new AIMessage({content: 'test'}),
      state: {messages: []},
      systemMessage: [],
      execution: {} as never,
    } as never;

    await mw.afterModel!(ctx);
    expect(tracker.getUsage().totalTokens).toBe(0);
  });
});
