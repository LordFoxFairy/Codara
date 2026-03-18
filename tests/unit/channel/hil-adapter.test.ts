import {describe, test, expect, beforeEach} from 'bun:test';
import {ChannelRegistry} from '@integration/channel/registry';
import {createChannelHILOptions} from '@integration/channel/hil-adapter';
import type {Channel} from '@shared/contracts/channel';
import type {PauseRequest} from '@shared/contracts/agent-types';
import type {ToolCallContext} from '@core/pipeline/types';

function createMockChannel(id: string): Channel & {
  pauseRequests: PauseRequest[];
  events: unknown[];
} {
  const mock = {
    id,
    type: 'cli' as const,
    pauseRequests: [] as PauseRequest[],
    events: [] as unknown[],
    async sendMessage() {},
    async showPauseRequest(request: PauseRequest) {
      mock.pauseRequests.push(request);
      return {decision: 'approve'};
    },
    emitEvent(event: unknown) {
      mock.events.push(event);
    },
  };
  return mock;
}

function createPauseRequest(channel?: string): PauseRequest {
  return {
    id: 'pause-1',
    description: 'Confirm bash execution',
    action: {toolCallId: 'tc-1', toolName: 'bash', toolArgs: {command: 'echo hi'}},
    review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
    runtime: {runId: 'run-1', turn: 1, requestId: 'req-1', toolIndex: 0},
    ...(channel ? {channel} : {}),
  };
}

const stubContext = {} as ToolCallContext;

describe('createChannelHILOptions', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  test('onPause emits event to resolved channel', async () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    const options = createChannelHILOptions(registry);
    await options.onPause!(createPauseRequest(), stubContext);
    expect(ch.events.length).toBe(1);
    expect((ch.events[0] as {kind: string}).kind).toBe('hil');
  });

  test('onPause is silent when no channel available', async () => {
    const options = createChannelHILOptions(registry);
    // Should not throw
    await options.onPause!(createPauseRequest(), stubContext);
  });

  test('resolveResume routes to channel.showPauseRequest', async () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    const options = createChannelHILOptions(registry);
    const result = await options.resolveResume!(createPauseRequest(), stubContext);
    expect(result).toEqual({decision: 'approve'});
    expect(ch.pauseRequests.length).toBe(1);
  });

  test('resolveResume returns undefined when no channel', async () => {
    const options = createChannelHILOptions(registry);
    const result = await options.resolveResume!(createPauseRequest(), stubContext);
    expect(result).toBeUndefined();
  });

  test('resolveResume routes to specific channel via request.channel', async () => {
    const cli = createMockChannel('cli-1');
    const web = createMockChannel('web-1');
    registry.register(cli);
    registry.register(web);
    const options = createChannelHILOptions(registry);
    await options.resolveResume!(createPauseRequest('web-1'), stubContext);
    expect(web.pauseRequests.length).toBe(1);
    expect(cli.pauseRequests.length).toBe(0);
  });
});
