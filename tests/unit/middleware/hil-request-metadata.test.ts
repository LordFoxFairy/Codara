import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {createHILMiddleware, parseHILToolMessagePayload, type ToolCallContext} from '@core/middleware';

function createToolContext(toolCall: ToolCall): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: {}},
    systemMessage: [],
    runId: 'run_hil_meta_1',
    turn: 1,
    maxTurns: 3,
    requestId: 'req_hil_meta_1',
    toolCall,
    toolIndex: 0,
  };
}

function parsePauseContent(content: unknown): Record<string, unknown> {
  return JSON.parse(typeof content === 'string' ? content : String(content)) as Record<string, unknown>;
}

describe('HIL request metadata', () => {
  it('should include channel/ui/metadata in pause request', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {
        bash: {
          description: 'Need approval for shell command',
          channel: 'permission-center',
          ui: {
            tab: 'Security',
            modal: 'permission-review',
            actions: [
              {id: 'allow_once', label: 'Allow once', kind: 'primary'},
              {id: 'deny', label: 'Deny', kind: 'danger', requiresConfirmation: true},
            ],
          },
          metadata: {skill: 'permission-policy'},
        },
      },
    });

    const toolCall: ToolCall = {id: 'call_meta_1', name: 'bash', args: {command: 'git status'}};
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_meta_1'});
    });

    const payload = parsePauseContent(result?.content);
    const request = payload.request as Record<string, unknown>;

    expect(payload.type).toBe('hil_pause');
    expect(request.description).toBe('Need approval for shell command');
    expect(request.channel).toBe('permission-center');
    expect((request.ui as Record<string, unknown>)?.tab).toBe('Security');
    expect(Array.isArray((request.ui as {actions?: unknown[]})?.actions)).toBe(true);
    expect(((request.ui as {actions?: Array<{id: string}>})?.actions ?? [])[0]?.id).toBe('allow_once');
    expect((request.review as {actionName?: string})?.actionName).toBe('bash');
    expect((request.review as {allowedDecisions?: string[]})?.allowedDecisions).toEqual(['approve', 'edit', 'reject']);
    expect((request.metadata as Record<string, unknown>)?.skill).toBe('permission-policy');
  });

  it('should allow custom review decisions in pause request', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {
        bash: {
          allowedDecisions: ['approve', 'reject', 'approve'],
        },
      },
    });

    const toolCall: ToolCall = {id: 'call_meta_1b', name: 'bash', args: {command: 'git push'}};
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_meta_1b'});
    });

    const payload = parsePauseContent(result?.content);
    const request = payload.request as Record<string, unknown>;
    expect((request.review as {allowedDecisions?: string[]})?.allowedDecisions).toEqual(['approve', 'reject']);
  });

  it('should parse structured deny payloads via helper', async () => {
    const middleware = createHILMiddleware({
      resolveDecision: () => ({
        decision: 'deny',
        reason: 'Blocked by test policy',
        metadata: {skill: 'policy-test'},
      }),
    });

    const toolCall: ToolCall = {id: 'call_meta_deny_1', name: 'bash', args: {command: 'git push'}};
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_meta_deny_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_deny');
    expect(payload?.type === 'hil_deny' ? payload.reason : '').toBe('Blocked by test policy');
  });

  it('should support wildcard interruptOn patterns', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {
        'bash*': true,
      },
    });

    const toolCall: ToolCall = {id: 'call_meta_2', name: 'bash_exec', args: {command: 'echo 1'}};
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_meta_2'});
    });

    const payload = parsePauseContent(result?.content);
    expect(payload.type).toBe('hil_pause');
  });

  it('should pass through when wildcard does not match', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {
        'bash*': true,
      },
    });

    const toolCall: ToolCall = {id: 'call_meta_3', name: 'read_file', args: {path: 'a.txt'}};
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'executed', tool_call_id: 'call_meta_3'});
    });

    expect(String(result?.content)).toBe('executed');
  });
});
