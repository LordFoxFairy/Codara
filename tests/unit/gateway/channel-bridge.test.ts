import {describe, test, expect, beforeEach} from 'bun:test';
import {GatewayChannelBridge} from '@gateway/channel-bridge';
import type {ChannelPlugin} from '@integration/channel/contracts';
import type {PauseRequest} from '@shared/contracts/agent-types';
import {z} from 'zod';

function createMockPlugin(overrides: Partial<ChannelPlugin> = {}): ChannelPlugin & {
  sentTexts: Array<{to: string; text: string}>;
  sentPauses: Array<{to: string; text: string; pauseId: string}>;
} {
  const sentTexts: Array<{to: string; text: string}> = [];
  const sentPauses: Array<{to: string; text: string; pauseId: string}> = [];

  return {
    id: 'telegram',
    name: 'Telegram',
    capabilities: {
      chatTypes: ['direct', 'group'],
      streaming: false,
      threads: true,
      media: true,
      reactions: false,
      textLimit: 4096,
    },
    configSchema: z.object({}),
    resolveAccount: () => ({id: 'acc1'}),
    startListening: async () => ({async stop() {}}),
    async sendText(_account, ctx) {
      sentTexts.push({to: ctx.to, text: ctx.text});
      return {ok: true};
    },
    async sendPausePrompt(_account, ctx) {
      sentPauses.push({to: ctx.to, text: ctx.text, pauseId: ctx.pause.id});
      return {ok: true};
    },
    sentTexts,
    sentPauses,
    ...overrides,
  };
}

function makePauseRequest(overrides: Partial<PauseRequest> = {}): PauseRequest {
  return {
    id: 'pause-1',
    description: 'Execute bash command',
    action: {toolCallId: 'tc1', toolName: 'bash', toolArgs: {command: 'ls -la'}},
    review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
    runtime: {runId: 'run1', turn: 1, requestId: 'req1', toolIndex: 0},
    ...overrides,
  };
}

describe('GatewayChannelBridge', () => {
  let plugin: ReturnType<typeof createMockPlugin>;
  let bridge: GatewayChannelBridge;

  beforeEach(() => {
    plugin = createMockPlugin();
    bridge = new GatewayChannelBridge(plugin, {id: 'acc1'}, 'user1', 'bot1', 'telegram');
  });

  test('has correct id and type', () => {
    expect(bridge.id).toBe('gateway:telegram:bot1:user1');
    expect(bridge.type).toBe('telegram');
  });

  test('sendMessage delegates to plugin.sendText', async () => {
    await bridge.sendMessage({type: 'text', content: 'Hello!'});

    expect(plugin.sentTexts.length).toBe(1);
    expect(plugin.sentTexts[0]!.to).toBe('user1');
    expect(plugin.sentTexts[0]!.text).toBe('Hello!');
  });

  test('showPauseRequest sends prompt via plugin.sendPausePrompt', async () => {
    const request = makePauseRequest();

    // Don't await — the promise waits for handlePauseResponse
    const resultPromise = bridge.showPauseRequest(request);

    // Verify the pause prompt was sent
    expect(plugin.sentPauses.length).toBe(1);
    expect(plugin.sentPauses[0]!.pauseId).toBe('pause-1');
    expect(plugin.sentPauses[0]!.to).toBe('user1');
    expect(bridge.hasPendingPauses()).toBe(true);

    // Resolve the pause
    bridge.handlePauseResponse('pause-1', 'approve');

    const result = await resultPromise;
    expect(result).toEqual({decision: 'approve'});
    expect(bridge.hasPendingPauses()).toBe(false);
  });

  test('showPauseRequest falls back to sendText when sendPausePrompt is missing', async () => {
    const plainPlugin = createMockPlugin({sendPausePrompt: undefined});
    const plainBridge = new GatewayChannelBridge(plainPlugin, {id: 'acc1'}, 'user1', 'bot1', 'telegram');

    const request = makePauseRequest();
    const resultPromise = plainBridge.showPauseRequest(request);

    // Should fall back to sendText
    expect(plainPlugin.sentTexts.length).toBe(1);
    expect(plainPlugin.sentTexts[0]!.text).toContain('bash');

    plainBridge.handlePauseResponse('pause-1', 'reject');
    const result = await resultPromise;
    expect(result).toEqual({decision: 'reject'});
  });

  test('handlePauseResponse returns false for unknown pauseId', () => {
    expect(bridge.handlePauseResponse('nonexistent', 'approve')).toBe(false);
  });

  test('handlePauseResponse returns true and resolves for known pauseId', async () => {
    const request = makePauseRequest({id: 'pause-2'});
    const resultPromise = bridge.showPauseRequest(request);

    const handled = bridge.handlePauseResponse('pause-2', 'edit');
    expect(handled).toBe(true);

    const result = await resultPromise;
    expect(result).toEqual({decision: 'edit'});
  });

  test('dispose rejects all pending pauses', async () => {
    const request1 = makePauseRequest({id: 'p1'});
    const request2 = makePauseRequest({id: 'p2'});

    const p1 = bridge.showPauseRequest(request1);
    const p2 = bridge.showPauseRequest(request2);

    await bridge.dispose();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({decision: 'reject', reason: 'Channel disposed'});
    expect(r2).toEqual({decision: 'reject', reason: 'Channel disposed'});
    expect(bridge.hasPendingPauses()).toBe(false);
  });

  test('builds default actions when review.allowedDecisions is empty', async () => {
    const request = makePauseRequest({
      review: {actionName: 'bash', allowedDecisions: []},
    });

    const resultPromise = bridge.showPauseRequest(request);

    // The pause prompt should still be sent with default actions
    expect(plugin.sentPauses.length).toBe(1);

    bridge.handlePauseResponse(request.id, 'approve');
    await resultPromise;
  });

  test('builds actions for all decision types', async () => {
    const request = makePauseRequest({
      review: {actionName: 'bash', allowedDecisions: ['approve', 'edit', 'reject']},
    });

    const resultPromise = bridge.showPauseRequest(request);
    expect(plugin.sentPauses.length).toBe(1);

    bridge.handlePauseResponse(request.id, 'approve');
    await resultPromise;
  });
});
