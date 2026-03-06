import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {
  applyHILResumeToolEdits,
  createHILMiddleware,
  humanInTheLoopMiddleware,
  parseHILResumeActionPayload,
  type ToolCallContext,
} from '@core/middleware';

function createToolContext(toolCall: ToolCall, runtimeContext: Record<string, unknown> = {}): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: runtimeContext},
    systemMessage: [],
    runId: 'run_hil_1',
    turn: 1,
    maxTurns: 3,
    requestId: 'req_hil_1',
    toolCall,
    toolIndex: 0,
  };
}

interface ParsedPauseMessage {
  type: string;
  request: {
    id: string;
    action: {
      toolCallId: string;
      toolName: string;
    };
    runtime: {
      runId: string;
    };
  };
}

function parsePauseMessageContent(content: unknown): ParsedPauseMessage {
  const raw = typeof content === 'string' ? content : String(content);
  const parsed = JSON.parse(raw) as ParsedPauseMessage;
  return parsed;
}

describe('createHILMiddleware', () => {
  it('should export langchain-style alias', () => {
    expect(humanInTheLoopMiddleware).toBe(createHILMiddleware);
  });

  it('should pass through when interruptOn is not configured', async () => {
    const middleware = createHILMiddleware();
    const toolCall: ToolCall = {id: 'call_auto_1', name: 'write_file', args: {path: 'a.txt'}};

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'ok', tool_call_id: 'call_auto_1'});
    });

    expect(String(result?.content)).toBe('ok');
  });

  it('should pause when interruptOn=true and no resume payload', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {
        write_file: true,
      },
    });

    const toolCall: ToolCall = {id: 'call_pause_1', name: 'write_file', args: {path: 'a.txt'}};
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_pause_1'});
    });

    const parsed = parsePauseMessageContent(result?.content);
    expect(parsed.type).toBe('hil_pause');
    expect(parsed.request.action.toolName).toBe('write_file');
    expect(parsed.request.action.toolCallId).toBe('call_pause_1');
    expect(parsed.request.runtime.runId).toBe('run_hil_1');
  });

  it('should call onPause hook with pause request', async () => {
    let seenToolCallId = '';
    let seenToolName = '';

    const middleware = createHILMiddleware({
      interruptOn: {write_file: true},
      onPause: (request) => {
        seenToolCallId = request.action.toolCallId;
        seenToolName = request.action.toolName;
      },
    });

    const toolCall: ToolCall = {id: 'call_pause_2', name: 'write_file', args: {path: 'b.txt'}};
    await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_pause_2'});
    });

    expect(seenToolCallId).toBe('call_pause_2');
    expect(seenToolName).toBe('write_file');
  });

  it('should continue execution when runtime resume payload exists', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {write_file: true},
    });

    const toolCall: ToolCall = {id: 'call_resume_1', name: 'write_file', args: {path: 'c.txt'}};
    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resume: {ticket: 'approved'},
        },
      }),
      async () => new ToolMessage({content: 'continued', tool_call_id: 'call_resume_1'})
    );

    expect(String(result?.content)).toBe('continued');
  });

  it('should allow custom handleResume to apply interaction result', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {write_file: true},
      handleResume: async (_request, resumePayload, context, handler) => {
        const payload = resumePayload as {editedPath?: string};
        if (payload.editedPath) {
          const editedToolCall: ToolCall = {
            ...context.toolCall,
            args: {
              ...(context.toolCall.args as Record<string, unknown>),
              path: payload.editedPath,
            },
          };
          return handler({...context, toolCall: editedToolCall});
        }
        return handler(context);
      },
    });

    const toolCall: ToolCall = {id: 'call_resume_2', name: 'write_file', args: {path: 'raw.txt'}};
    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resume: {editedPath: 'safe.txt'},
        },
      }),
      async (request) => {
        const path = (request?.toolCall.args as {path: string}).path;
        return new ToolMessage({content: `path:${path}`, tool_call_id: 'call_resume_2'});
      }
    );

    expect(String(result?.content)).toBe('path:safe.txt');
  });

  it('should support runtime interruptOn override via context.hil.interruptOn', async () => {
    const middleware = createHILMiddleware();
    const toolCall: ToolCall = {id: 'call_override_1', name: 'write_file', args: {path: 'd.txt'}};

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          interruptOn: {
            write_file: true,
          },
        },
      }),
      async () => new ToolMessage({content: 'should-not-run', tool_call_id: 'call_override_1'})
    );

    const parsed = parsePauseMessageContent(result?.content);
    expect(parsed.type).toBe('hil_pause');
    expect(parsed.request.action.toolCallId).toBe('call_override_1');
  });

  it('should expose helpers for action-based resume payloads', () => {
    const payload = parseHILResumeActionPayload({
      action: 'edit',
      scope: 'project',
      editedToolName: 'bash',
      editedToolArgs: {command: 'git diff --stat'},
      metadata: {source: 'permission-center'},
    });

    expect(payload.action).toBe('edit');
    expect(payload.scope).toBe('project');
    expect(payload.editedToolName).toBe('bash');
    expect(payload.editedToolArgs).toEqual({command: 'git diff --stat'});
    expect(payload.metadata).toEqual({source: 'permission-center'});
  });

  it('should apply generic tool edits from resume payload', () => {
    const context = createToolContext({id: 'call_edit_1', name: 'bash', args: {command: 'git status'}});
    const edited = applyHILResumeToolEdits(context, {
      action: 'edit',
      editedToolArgs: {command: 'git diff --stat'},
    });

    expect((edited.toolCall.args as {command: string}).command).toBe('git diff --stat');
    expect(edited.toolCall.name).toBe('bash');
  });
});
