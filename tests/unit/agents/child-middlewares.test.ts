import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {MIDDLEWARE_NAMES} from '@core/pipeline-types';
import {buildSubagentChildMiddlewares} from '@capability/subagent/middleware';
import {ensurePermissionSettingsFile} from '@core/middleware/permission';
import {parseReviewToolMessagePayload, type ToolCallContext} from '@core/middleware';

function createToolContext(toolCall: ToolCall, runtimeContext: Record<string, unknown> = {}): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: runtimeContext},
    systemMessage: [],
    execution: {
      sessionId: 'session_child_permission_1',
      runId: 'run_child_permission_1',
      turn: 1,
      maxTurns: 3,
      requestId: 'req_child_permission_1',
      toolIndex: 0,
      toolCallId: toolCall.id ?? 'tool_0',
    },
    toolCall,
    toolIndex: 0,
  };
}

describe('buildSubagentChildMiddlewares', () => {
  it('keeps background child runs non-interactive by default', () => {
    const middlewares = buildSubagentChildMiddlewares({
      model: async () => {
        throw new Error('not used');
      },
      childRuntime: {
        interactionMode: 'background',
        review: {},
      },
    });

    expect(middlewares.some((middleware) => middleware.name === MIDDLEWARE_NAMES.AskUserQuestion)).toBe(false);
    expect(middlewares.some((middleware) => middleware.name === MIDDLEWARE_NAMES.Permission)).toBe(true);
  });

  it('allows foreground child runs to keep interactive clarification and permission middleware', () => {
    const middlewares = buildSubagentChildMiddlewares({
      model: async () => {
        throw new Error('not used');
      },
      childRuntime: {
        interactionMode: 'foreground',
        review: {},
      },
    });

    expect(middlewares.some((middleware) => middleware.name === MIDDLEWARE_NAMES.AskUserQuestion)).toBe(true);
    expect(middlewares.some((middleware) => middleware.name === MIDDLEWARE_NAMES.Permission)).toBe(true);
  });

  it('routes background child permission requests through the main review contract', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-child-permission-bg-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middlewares = buildSubagentChildMiddlewares({
      model: async () => {
        throw new Error('not used');
      },
      childRuntime: {
        interactionMode: 'background',
        review: {},
        projectRoot,
        cwd: projectRoot,
      },
    });
    const permissionMiddleware = middlewares.find((middleware) => middleware.name === MIDDLEWARE_NAMES.Permission);
    const toolCall: ToolCall = {id: 'call_child_permission_background_1', name: 'bash', args: {command: 'touch guarded.txt'}};

    const result = await permissionMiddleware?.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_child_permission_background_1'});
    });

    const payload = parseReviewToolMessagePayload(result?.content);
    expect(payload?.type).toBe('review_pause');
  });

  it('still opens review for foreground child permission requests', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-child-permission-fg-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middlewares = buildSubagentChildMiddlewares({
      model: async () => {
        throw new Error('not used');
      },
      childRuntime: {
        interactionMode: 'foreground',
        review: {},
        projectRoot,
        cwd: projectRoot,
      },
    });
    const permissionMiddleware = middlewares.find((middleware) => middleware.name === MIDDLEWARE_NAMES.Permission);
    const toolCall: ToolCall = {id: 'call_child_permission_foreground_1', name: 'bash', args: {command: 'touch guarded.txt'}};

    const result = await permissionMiddleware?.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_child_permission_foreground_1'});
    });

    const payload = parseReviewToolMessagePayload(result?.content);
    expect(payload?.type).toBe('review_pause');
  });
});
