import {describe, test, expect, beforeEach} from 'bun:test';
import {SSEChannel} from '../../../src/server/channel';
import type {PauseRequest} from '@shared/contracts/agent-types';

interface SentEvent {
  event: string;
  data: unknown;
  id?: string;
}

function createPauseRequest(id = 'pause-1'): PauseRequest {
  return {
    id,
    description: 'Confirm bash execution',
    action: {toolCallId: 'tc-1', toolName: 'bash', toolArgs: {command: 'echo hi'}},
    review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
    runtime: {runId: 'run-1', turn: 1, requestId: 'req-1', toolIndex: 0},
  };
}

describe('SSEChannel', () => {
  let events: SentEvent[];
  let channel: SSEChannel;

  beforeEach(() => {
    events = [];
    channel = new SSEChannel({
      id: 'test-sse',
      send: (event) => events.push(event),
    });
  });

  test('has correct id and type', () => {
    expect(channel.id).toBe('test-sse');
    expect(channel.type).toBe('web');
  });

  test('sendMessage sends SSE message event', async () => {
    await channel.sendMessage({type: 'text', content: 'hello'});
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('message');
  });

  test('showPauseRequest sends SSE review_required event', async () => {
    const pausePromise = channel.showPauseRequest(createPauseRequest());
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('review_required');
    expect((events[0].data as {id: string}).id).toBe('pause-1');

    // Resolve
    const resolved = channel.resolveResume('pause-1', {decision: 'approve'});
    expect(resolved).toBe(true);

    const result = await pausePromise;
    expect(result).toEqual({decision: 'approve'});
  });

  test('resolveResume returns false for unknown id', () => {
    expect(channel.resolveResume('nonexistent', {})).toBe(false);
  });

  test('hasPendingPauses tracks pending state', async () => {
    expect(channel.hasPendingPauses()).toBe(false);

    const promise = channel.showPauseRequest(createPauseRequest());
    expect(channel.hasPendingPauses()).toBe(true);
    expect(channel.getPendingPauseIds()).toEqual(['pause-1']);

    channel.resolveResume('pause-1', {});
    await promise;
    expect(channel.hasPendingPauses()).toBe(false);
  });

  test('emitEvent sends runtime_event SSE', () => {
    channel.emitEvent({
      id: 'evt-1',
      kind: 'tool',
      phase: 'start',
      status: 'running',
      label: 'Reading file',
    });
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('runtime_event');
  });

  test('dispose resolves pending pauses with reject', async () => {
    const promise = channel.showPauseRequest(createPauseRequest());
    await channel.dispose();

    const result = await promise;
    expect((result as {decision: string}).decision).toBe('reject');
  });

  test('operations are no-op after dispose', async () => {
    await channel.dispose();
    await channel.sendMessage({type: 'text', content: 'ignored'});
    // Only the dispose-time events, not the sendMessage
    expect(events.length).toBe(0);
  });
});
