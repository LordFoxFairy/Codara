import {describe, expect, it} from 'bun:test';
import {ToolMessage, type ToolCall} from '@langchain/core/messages';
import {createInstructionLoadingMiddleware} from '@core/middleware';
import type {ToolCallContext} from '@core/middleware/types';

describe('instruction loading middleware', () => {
  it('activates deeper instruction sources only after a successful read_file call', async () => {
    const hits: string[] = [];
    const middleware = createInstructionLoadingMiddleware({
      promptSource: {
        activateTarget: async (target) => {
          hits.push(`prompt:${target.path}`);
          return true;
        },
      },
      guidelinesSource: {
        activateTarget: async (target) => {
          hits.push(`guidelines:${target.path}`);
          return true;
        },
      },
    });
    if (!middleware?.wrapToolCall) {
      throw new Error('Instruction loading middleware should expose wrapToolCall.');
    }

    const context = createToolCallContext({
      name: 'read_file',
      args: {path: '/repo/packages/app/src/feature.ts'},
    });
    const result = await middleware.wrapToolCall(context, async () => (
      new ToolMessage({content: 'export const feature = true;', tool_call_id: 'call_read_file_1'})
    ));

    expect(result.content).toBe('export const feature = true;');
    expect(hits).toEqual([
      'prompt:/repo/packages/app/src/feature.ts',
      'guidelines:/repo/packages/app/src/feature.ts',
    ]);
  });

  it('does not activate instruction sources for failed tool results', async () => {
    let activated = false;
    const middleware = createInstructionLoadingMiddleware({
      guidelinesSource: {
        activateTarget: async () => {
          activated = true;
          return true;
        },
      },
    });
    if (!middleware?.wrapToolCall) {
      throw new Error('Instruction loading middleware should expose wrapToolCall.');
    }

    await middleware.wrapToolCall(
      createToolCallContext({
        name: 'read_file',
        args: {path: '/repo/packages/app/src/feature.ts'},
      }),
      async () => new ToolMessage({
        content: 'Tool execution failed: denied',
        tool_call_id: 'call_read_file_2',
        status: 'error',
      }),
    );

    expect(activated).toBe(false);
  });

  it('does not activate instruction sources for HIL pause/deny tool messages', async () => {
    const hits: string[] = [];
    const middleware = createInstructionLoadingMiddleware({
      promptSource: {
        activateTarget: async (target) => {
          hits.push(target.path);
          return true;
        },
      },
    });
    if (!middleware?.wrapToolCall) {
      throw new Error('Instruction loading middleware should expose wrapToolCall.');
    }

    const context = createToolCallContext({
      name: 'read_file',
      args: {path: '/repo/packages/app/src/feature.ts'},
    });

    await middleware.wrapToolCall(context, async () => new ToolMessage({
      content: JSON.stringify({
        type: 'hil_pause',
        request: {
          id: 'pause_read',
          description: 'Need approval before reading this file',
          action: {
            toolCallId: 'call_read_file_3',
            toolName: 'read_file',
            toolArgs: {path: '/repo/packages/app/src/feature.ts'},
          },
          review: {
            actionName: 'read_file',
            allowedDecisions: ['approve', 'reject'],
          },
          runtime: {
            runId: 'run_1',
            turn: 1,
            requestId: 'request_1',
            toolIndex: 0,
          },
        },
      }),
      tool_call_id: 'call_read_file_3',
      name: 'read_file',
    }));

    await middleware.wrapToolCall(context, async () => new ToolMessage({
      content: JSON.stringify({
        type: 'hil_deny',
        reason: 'denied',
        metadata: {},
        action: {
          toolCallId: 'call_read_file_4',
          toolName: 'read_file',
        },
      }),
      tool_call_id: 'call_read_file_4',
      name: 'read_file',
      status: 'error',
    }));

    expect(hits).toEqual([]);
  });
});

function createToolCallContext(toolCall: {
  name: string;
  args: Record<string, unknown>;
}): ToolCallContext {
  return {
    state: {
      agentType: 'main',
      messages: [],
      context: {},
      values: {},
    },
    messages: [],
    runtime: {
      context: {},
      runtimeContext: {},
      shared: {},
    },
    systemMessage: [],
    execution: {
      sessionId: 'session_1',
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'request_1',
      toolIndex: 0,
      toolCallId: 'call_read_file',
    },
    toolCall: {
      id: 'call_read_file',
      name: toolCall.name,
      args: toolCall.args,
    } as ToolCall,
    toolIndex: 0,
    tool: undefined,
  };
}
