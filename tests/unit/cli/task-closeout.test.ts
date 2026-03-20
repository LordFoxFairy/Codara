import {describe, expect, it} from 'bun:test';
import {isInvalidTaskCloseoutResponse, shouldRetryTaskCloseoutResponse} from '../../../src/cli/task-closeout';

describe('task closeout rules', () => {
  it('marks stale waiting or staged narration as invalid', () => {
    expect(isInvalidTaskCloseoutResponse('Phase 1 has started. Waiting for subagent results.')).toBe(true);
    expect(isInvalidTaskCloseoutResponse('I will continue with phase 2 after the delegated tasks return.')).toBe(true);
  });

  it('does not retry when the continuation launched a Task tool call for the next phase', () => {
    expect(shouldRetryTaskCloseoutResponse({
      text: 'Starting the second phase now.',
      launchedTaskToolCall: true,
      attempt: 1,
      maxAttempts: 2,
    })).toBe(false);
  });

  it('retries invalid closeout narration when no next-phase task launch happened yet', () => {
    expect(shouldRetryTaskCloseoutResponse({
      text: 'Phase 1 has started. Waiting for subagent results.',
      launchedTaskToolCall: false,
      attempt: 1,
      maxAttempts: 2,
    })).toBe(true);
  });
});
