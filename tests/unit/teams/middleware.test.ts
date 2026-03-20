import {describe, expect, test} from 'bun:test';
import {createTeamMiddleware} from '@capability/team/middleware';
import {TeamRegistry} from '@capability/team/coordination/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {MemorySharedState} from '@capability/team/shared-state';
import type {BeforeModelContext} from '@core/pipeline/types';
import {HumanMessage} from '@langchain/core/messages';

describe('team middleware', () => {
  test('leader context drains the synthetic leader inbox into the next model call', async () => {
    const registry = new TeamRegistry();
    const runtime = new TeamRuntime({
      registry,
      projectRoot: '/tmp/test-team-middleware',
      createSession: () => ({
        invoke: async () => ({reason: 'complete' as const}),
        dispose: async () => {},
      }),
    });
    const sharedState = new MemorySharedState();
    const team = registry.createTeam({name: 'team-inbox', goal: 'Handle worker updates'});
    const middleware = createTeamMiddleware({
      teamType: 'leader',
      registry,
      runtime,
      sharedState,
    });

    await runtime.startTeam(team.teamId);
    const worker = await runtime.spawnMember(team.teamId, 'worker-a', 'worker');
    const transport = runtime.getTransport(team.teamId)!;
    await transport.send('leader', {
      id: 'msg-team-leader-inbox',
      from: worker.memberId,
      to: 'leader',
      teamId: team.teamId,
      type: 'question',
      content: 'Should I keep going?',
      timestamp: new Date().toISOString(),
      read: false,
    });

    const context: BeforeModelContext = {
      state: {messages: [new HumanMessage('status?')]},
      messages: [new HumanMessage('status?')],
      runtime: {
        context: {
          teamSurface: {
            activeTeamId: team.teamId,
            teamRole: 'leader',
            teamMode: 'leader',
          },
        },
      },
      systemMessage: [],
      execution: {
        sessionId: 'session-team-middleware',
        runId: 'run-team-middleware',
        turn: 1,
        maxTurns: 8,
        requestId: 'req-team-middleware',
      },
    };

    await middleware.beforeModel?.(context);

    expect(context.systemMessage.some((message) => message.includes('## Team Leader Context'))).toBe(true);
    expect(context.systemMessage.some((message) => message.includes('--- Team Leader Inbox ---'))).toBe(true);
    expect(context.systemMessage.some((message) => message.includes('worker-a asks: Should I keep going?'))).toBe(true);

    await runtime.killTeam(team.teamId);
  });
});
