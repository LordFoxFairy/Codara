import {describe, test, expect, beforeEach} from 'bun:test';
import {SSEChannel} from '../../../src/server/channel';
import type {ReviewRequest} from '@shared/contracts/agent-types';

interface SentEvent {
  event: string;
  data: unknown;
  id?: string;
}

function createReviewRequest(id = 'review-1'): ReviewRequest {
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

  test('showReviewRequest sends SSE review_required event', async () => {
    const reviewPromise = channel.showReviewRequest(createReviewRequest());
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('review_required');
    expect((events[0].data as {id: string}).id).toBe('review-1');

    // Resolve
    const resolved = channel.resolveResume('review-1', {decision: 'approve'});
    expect(resolved).toBe(true);

    const result = await reviewPromise;
    expect(result).toEqual({decision: 'approve'});
  });

  test('resolveResume returns false for unknown id', () => {
    expect(channel.resolveResume('nonexistent', {})).toBe(false);
  });

  test('hasPendingReviews tracks pending state', async () => {
    expect(channel.hasPendingReviews()).toBe(false);

    const promise = channel.showReviewRequest(createReviewRequest());
    expect(channel.hasPendingReviews()).toBe(true);
    expect(channel.getPendingReviewIds()).toEqual(['review-1']);

    channel.resolveResume('review-1', {});
    await promise;
    expect(channel.hasPendingReviews()).toBe(false);
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

  test('dispose resolves pending reviews with reject', async () => {
    const promise = channel.showReviewRequest(createReviewRequest());
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
