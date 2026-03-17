import { describe, test, expect } from 'bun:test';
import {
  sortInbox,
  formatTeamMessage,
  prepareInboxInjection,
} from '@capability/team/runtime/message-injector';
import type { TeamMessage } from '@capability/team/types';

function makeMsg(overrides: Partial<TeamMessage>): TeamMessage {
  return {
    id: crypto.randomUUID(),
    from: 'worker-1',
    to: 'leader',
    teamId: 'team_1',
    type: 'message',
    content: 'test',
    timestamp: new Date().toISOString(),
    read: false,
    ...overrides,
  };
}

// ─── sortInbox ────────────────────────────────────────────────────────────────

describe('sortInbox', () => {
  test('user messages come first, then by timestamp', () => {
    const t1 = '2024-01-01T00:00:01.000Z';
    const t2 = '2024-01-01T00:00:02.000Z';
    const t3 = '2024-01-01T00:00:03.000Z';

    const workerMsg = makeMsg({ from: 'worker-1', timestamp: t1 });
    const userMsg = makeMsg({ from: 'user', timestamp: t3 });
    const leaderMsg = makeMsg({ from: 'leader', timestamp: t2 });

    const sorted = sortInbox([workerMsg, userMsg, leaderMsg]);
    expect(sorted[0].from).toBe('user');
    // remaining two sorted by timestamp ascending
    expect(sorted[1].timestamp <= sorted[2].timestamp).toBe(true);
  });

  test('empty array returns empty', () => {
    expect(sortInbox([])).toEqual([]);
  });

  test('all user messages sorted by timestamp among themselves', () => {
    const t1 = '2024-01-01T00:00:01.000Z';
    const t2 = '2024-01-01T00:00:02.000Z';
    const t3 = '2024-01-01T00:00:03.000Z';

    const msgs = [
      makeMsg({ from: 'user', timestamp: t3 }),
      makeMsg({ from: 'user', timestamp: t1 }),
      makeMsg({ from: 'user', timestamp: t2 }),
    ];

    const sorted = sortInbox(msgs);
    expect(sorted[0].timestamp).toBe(t1);
    expect(sorted[1].timestamp).toBe(t2);
    expect(sorted[2].timestamp).toBe(t3);
  });

  test('non-user messages sorted by timestamp when no user messages', () => {
    const t1 = '2024-01-01T00:00:01.000Z';
    const t2 = '2024-01-01T00:00:02.000Z';

    const late = makeMsg({ from: 'worker-1', timestamp: t2 });
    const early = makeMsg({ from: 'leader', timestamp: t1 });

    const sorted = sortInbox([late, early]);
    expect(sorted[0].timestamp).toBe(t1);
    expect(sorted[1].timestamp).toBe(t2);
  });
});

// ─── formatTeamMessage ────────────────────────────────────────────────────────

describe('formatTeamMessage', () => {
  test("'message' type returns content as-is", () => {
    const msg = makeMsg({ type: 'message', content: 'hello world' });
    expect(formatTeamMessage(msg)).toBe('hello world');
  });

  test("'job_assigned' includes assignment text", () => {
    const msg = makeMsg({ type: 'job_assigned', content: 'implement feature X' });
    expect(formatTeamMessage(msg)).toBe('You have been assigned a job: implement feature X');
  });

  test("'job_submitted' formats correctly", () => {
    const msg = makeMsg({ type: 'job_submitted', content: 'PR #42' });
    expect(formatTeamMessage(msg)).toBe('Job submitted for review: PR #42');
  });

  test("'job_reviewed' approved path", () => {
    const msg = makeMsg({
      type: 'job_reviewed',
      content: 'Great work',
      metadata: { approved: true },
    });
    expect(formatTeamMessage(msg)).toBe('Job approved: Great work');
  });

  test("'job_reviewed' rejected with feedback", () => {
    const msg = makeMsg({
      type: 'job_reviewed',
      content: 'needs work',
      metadata: { approved: false, feedback: 'fix the tests' },
    });
    expect(formatTeamMessage(msg)).toBe('Job rejected. Feedback: fix the tests');
  });

  test("'job_reviewed' rejected without feedback falls back to content", () => {
    const msg = makeMsg({
      type: 'job_reviewed',
      content: 'needs improvement',
      metadata: { approved: false },
    });
    expect(formatTeamMessage(msg)).toBe('Job rejected. Feedback: needs improvement');
  });

  test("'job_completed' formats correctly", () => {
    const msg = makeMsg({ type: 'job_completed', content: 'Task done' });
    expect(formatTeamMessage(msg)).toBe('Job completed: Task done');
  });

  test("'question' includes sender name", () => {
    const msg = makeMsg({ type: 'question', from: 'worker-2', content: 'what should I do?' });
    expect(formatTeamMessage(msg)).toBe('Question from worker-2: what should I do?');
  });

  test("'answer' includes sender name", () => {
    const msg = makeMsg({ type: 'answer', from: 'leader', content: 'do X then Y' });
    expect(formatTeamMessage(msg)).toBe('Answer from leader: do X then Y');
  });

  test("'shutdown_request' returns fixed text", () => {
    const msg = makeMsg({ type: 'shutdown_request', content: 'ignored' });
    expect(formatTeamMessage(msg)).toBe('Team is shutting down. Finish current work and stop.');
  });

  test("'shutdown_response' includes sender", () => {
    const msg = makeMsg({ type: 'shutdown_response', from: 'worker-3', content: 'ok' });
    expect(formatTeamMessage(msg)).toBe('worker-3 acknowledged shutdown.');
  });

  test("'status_update' includes sender", () => {
    const msg = makeMsg({ type: 'status_update', from: 'worker-1', content: '50% done' });
    expect(formatTeamMessage(msg)).toBe('Status update from worker-1: 50% done');
  });

  test("'merge_conflict' formats correctly", () => {
    const msg = makeMsg({ type: 'merge_conflict', content: 'conflict in main.ts' });
    expect(formatTeamMessage(msg)).toBe('Merge conflict: conflict in main.ts');
  });

  test("'merge_request' formats correctly", () => {
    const msg = makeMsg({ type: 'merge_request', content: 'merge feature into main' });
    expect(formatTeamMessage(msg)).toBe('Merge request: merge feature into main');
  });

  test("'code_review' includes sender", () => {
    const msg = makeMsg({ type: 'code_review', from: 'reviewer-1', content: 'looks good' });
    expect(formatTeamMessage(msg)).toBe('Code review from reviewer-1: looks good');
  });

  test("'heartbeat' includes sender name", () => {
    const msg = makeMsg({ type: 'heartbeat', from: 'worker-1', content: '' });
    expect(formatTeamMessage(msg)).toBe('Heartbeat from worker-1');
  });
});

// ─── prepareInboxInjection ────────────────────────────────────────────────────

describe('prepareInboxInjection', () => {
  test('empty inbox returns empty array', () => {
    expect(prepareInboxInjection([])).toEqual([]);
  });

  test('wraps messages with [Team Message from ...] header', () => {
    const msg = makeMsg({ from: 'leader', type: 'message', content: 'hello' });
    const result = prepareInboxInjection([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/^\[Team Message from leader\] \(message\)/);
    expect(result[0]).toContain('\nhello');
  });

  test('combines sort + format: user messages appear first', () => {
    const t1 = '2024-01-01T00:00:01.000Z';
    const t2 = '2024-01-01T00:00:02.000Z';

    const workerMsg = makeMsg({ from: 'worker-1', type: 'status_update', content: 'working', timestamp: t1 });
    const userMsg = makeMsg({ from: 'user', type: 'message', content: 'hurry up', timestamp: t2 });

    const result = prepareInboxInjection([workerMsg, userMsg]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/^\[Team Message from user\]/);
    expect(result[1]).toMatch(/^\[Team Message from worker-1\]/);
  });

  test('formatted body appears after header', () => {
    const msg = makeMsg({ from: 'worker-2', type: 'job_assigned', content: 'build the API' });
    const result = prepareInboxInjection([msg]);
    expect(result[0]).toContain('[Team Message from worker-2] (job_assigned)');
    expect(result[0]).toContain('\nYou have been assigned a job: build the API');
  });

  test('multiple messages are all formatted', () => {
    const msgs = [
      makeMsg({ from: 'a', type: 'message', content: 'msg-a', timestamp: '2024-01-01T00:00:01.000Z' }),
      makeMsg({ from: 'b', type: 'heartbeat', content: '', timestamp: '2024-01-01T00:00:02.000Z' }),
    ];
    const result = prepareInboxInjection(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('msg-a');
    expect(result[1]).toContain('Heartbeat from b');
  });
});
