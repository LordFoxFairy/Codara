import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {mergeContext} from '@core/agent/command';
import {
  injectReviewResumePayload,
  normalizeAgentInput,
  readLatestReview,
} from '@core/agent/run/agent-loop';
import type {ReviewRequest} from '@core/middleware/review';

describe('agent runtime input helpers', () => {
  it('should normalize string and messages input into message arrays', () => {
    expect(normalizeAgentInput(undefined)).toEqual([]);
    expect(normalizeAgentInput('  hello  ')).toEqual([new HumanMessage('hello')]);
    expect(normalizeAgentInput({messages: [new HumanMessage('start')]})).toHaveLength(1);
  });

  it('should merge runtime context records without mutating inputs', () => {
    const base = {
      codara: {guidelines: 'v1'},
      request: {id: 'r1'},
    };
    const overrides = {
      codara: {summary: 'compact'},
      request: {trace: 't1'},
      custom: true,
    };

    const merged = mergeContext(base, overrides);

    expect(merged).toEqual({
      codara: {guidelines: 'v1', summary: 'compact'},
      request: {id: 'r1', trace: 't1'},
      custom: true,
    });
    expect(base).toEqual({
      codara: {guidelines: 'v1'},
      request: {id: 'r1'},
    });
  });

  it('should inject resume payload under both pause id and tool call id', () => {
    const review: ReviewRequest = {
      id: 'pause_1',
      description: 'review',
      action: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        toolArgs: {},
      },
      review: {
        actionName: 'approve tool',
        allowedDecisions: ['approve', 'reject'],
      },
      runtime: {
        runId: 'run_1',
        turn: 0,
        requestId: 'req_1',
        toolIndex: 0,
      },
    };

    const merged = injectReviewResumePayload({review: {existing: true}}, review, {decision: 'approve'});
    expect(merged.review).toEqual({
      existing: true,
      currentReview: review,
      resume: {decision: 'approve'},
      resumes: {
        pause_1: {decision: 'approve'},
        call_1: {decision: 'approve'},
      },
    });
  });

  it('should read the latest review pause request from tool messages', () => {
    const latest = readLatestReview([
      new ToolMessage({
        tool_call_id: 'call_old',
        content: JSON.stringify({
          type: 'review_pause',
          request: {
            id: 'pause_old',
            description: 'old',
            action: {toolCallId: 'call_old', toolName: 'bash', toolArgs: {}},
            review: {actionName: 'approve', allowedDecisions: ['approve']},
            runtime: {runId: 'run_1', turn: 0, requestId: 'req_1', toolIndex: 0},
          },
        }),
      }),
      new ToolMessage({
        tool_call_id: 'call_new',
        content: JSON.stringify({
          type: 'review_pause',
          request: {
            id: 'pause_new',
            description: 'new',
            action: {toolCallId: 'call_new', toolName: 'write_file', toolArgs: {}},
            review: {actionName: 'approve', allowedDecisions: ['approve']},
            runtime: {runId: 'run_2', turn: 1, requestId: 'req_2', toolIndex: 1},
          },
        }),
      }),
    ]);

    expect(latest?.id).toBe('pause_new');
    expect(latest?.action.toolName).toBe('write_file');
  });
});
