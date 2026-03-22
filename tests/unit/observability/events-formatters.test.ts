import {describe, expect, it} from 'bun:test';
import {ToolMessage} from '@langchain/core/messages';
import {summarizeSubagent} from '@observability/events/formatters';

describe('observability event formatters', () => {
  it('suppresses launch metadata details for delegated subagent start messages', () => {
    const message = new ToolMessage({
      content: 'Subagent started in background.',
      tool_call_id: 'call_task_1',
      artifact: {
        type: 'subagent_run_started',
        runId: 'run-1',
        parentSessionId: 'session-1',
        sessionId: 'session-1:task:run-1',
        agentName: 'Explore',
        label: 'Delegating Explore: Inspect the repo',
      },
    });

    expect(summarizeSubagent(message)).toBeUndefined();
  });
});
