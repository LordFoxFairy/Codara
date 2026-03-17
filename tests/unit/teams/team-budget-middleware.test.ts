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

  test('beforeModel blocks when team budget exceeded', async () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 100,
      onBudgetExceeded: 'shutdown',
    });
    const onAction = mock(() => {});

    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
      onBudgetAction: onAction,
    });

    // Exhaust team budget via afterModel first
    await mw.afterModel!(makeContext(80, 30));

    // Now beforeModel should detect exceeded and set shared flag
    const shared: Record<string, unknown> = {};
    const beforeCtx = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, shared},
      systemMessage: [],
      execution: {} as never,
    } as never;

    mw.beforeModel!(beforeCtx);

    // Verify shared flag was set
    expect(shared['__teamBudgetExceeded']).toBe('team');
    // onBudgetAction should have been called (once from afterModel exceeded, once from beforeModel)
    expect(onAction.mock.calls.some((c: unknown[]) => (c[0] as {action: string}).action === 'exceeded')).toBe(true);

    // wrapModelCall should short-circuit without calling handler
    const handler = mock(async () => new AIMessage('should not be called'));
    const wrapCtx = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, shared},
      systemMessage: [],
      execution: {} as never,
    } as never;

    const result = await mw.wrapModelCall!(wrapCtx, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(typeof result.content === 'string' && result.content).toContain('Team budget exceeded');
  });

  test('beforeModel blocks when member budget exceeded', async () => {
    const tracker = new TeamBudgetTracker({
      memberMaxTokens: 100,
      onBudgetExceeded: 'warn_leader',
    });
    const onAction = mock(() => {});
    const onMemberExceeded = mock(() => {});

    const mw = createTeamBudgetMiddleware({
      tracker,
      memberId: 'm1',
      model: 'claude-sonnet-4-6',
      onBudgetAction: onAction,
      onMemberBudgetExceeded: onMemberExceeded,
    });

    // Exhaust member budget
    await mw.afterModel!(makeContext(60, 50));

    // beforeModel should detect member budget exceeded
    const shared: Record<string, unknown> = {};
    const beforeCtx = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, shared},
      systemMessage: [],
      execution: {} as never,
    } as never;

    mw.beforeModel!(beforeCtx);

    expect(shared['__teamBudgetExceeded']).toBe('member');
    expect(onMemberExceeded).toHaveBeenCalledWith('m1');

    // wrapModelCall should short-circuit
    const handler = mock(async () => new AIMessage('should not be called'));
    const wrapCtx = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, shared},
      systemMessage: [],
      execution: {} as never,
    } as never;

    const result = await mw.wrapModelCall!(wrapCtx, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(typeof result.content === 'string' && result.content).toContain('Member budget exceeded');
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
