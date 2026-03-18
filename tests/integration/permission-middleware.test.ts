// tests/integration/permission-middleware.test.ts

import {describe, it, expect} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {createPermissionMiddleware, ensurePermissionSettingsFile} from '@/index';
import {parseHILToolMessagePayload, type ToolCallContext} from '@core/middleware';

function createToolContext(toolCall: ToolCall, runtimeContext: Record<string, unknown> = {}): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: runtimeContext},
    systemMessage: [],
    execution: {
      sessionId: 'session_integration_1',
      runId: 'run_integration_1',
      turn: 1,
      maxTurns: 3,
      requestId: 'req_integration_1',
      toolIndex: 0,
      toolCallId: toolCall.id ?? 'tool_0',
    },
    toolCall,
    toolIndex: 0,
  };
}

describe('Permission Middleware Integration', () => {
  it('should resolve allow decision for read tools', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-int-allow-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_read_1',
      name: 'read_file',
      args: {file_path: 'src/index.ts'},
      type: 'tool_call',
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'file-content', tool_call_id: 'call_read_1'});
    });

    // Read(*) is in default allow rules — should pass through
    expect(String(result?.content)).toBe('file-content');
  });

  it('should pause guarded tool calls with permission metadata', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-int-pause-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_edit_1',
      name: 'write_file',
      args: {file_path: 'src/danger.ts', content: 'x'},
      type: 'tool_call',
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_edit_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    expect(payload?.type === 'hil_pause' ? payload.request.channel : '').toBe('permission-center');
  });

  it('should handle session memory for edit tools', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-int-session-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_edit_session_1',
      name: 'edit_file',
      args: {file_path: 'src/components/Header.tsx'},
      type: 'tool_call',
    };

    // First call should pause (ask)
    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_edit_session_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
  });
});
