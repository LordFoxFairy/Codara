import {describe, expect, test} from 'bun:test';
import {ToolMessage} from '@langchain/core/messages';
import {createPathGuardMiddleware} from '@capability/team/security/path-guard-middleware';

const WORKTREE = '/workspace/teams/team1/worker-alice';

describe('PathGuardMiddleware', () => {
  const middleware = createPathGuardMiddleware(WORKTREE);

  function makeContext(toolName: string, args: Record<string, unknown>) {
    return {
      toolCall: {name: toolName, args, id: 'tc_1'},
      toolIndex: 0,
      state: {messages: []},
      systemMessage: [],
      execution: {} as never,
    } as never;
  }

  const passthrough = async () => new ToolMessage({content: 'ok', tool_call_id: 'tc_1'});

  test('allows path inside worktree', async () => {
    const ctx = makeContext('Read', {file_path: `${WORKTREE}/src/main.ts`});
    const result = await middleware.wrapToolCall!(ctx, passthrough);
    expect(result.content).toBe('ok');
  });

  test('blocks path outside worktree', async () => {
    const ctx = makeContext('Write', {file_path: '/etc/passwd'});
    const result = await middleware.wrapToolCall!(ctx, passthrough);
    expect(String(result.content)).toContain('[PathGuard] Access denied');
  });

  test('blocks path in different worktree', async () => {
    const ctx = makeContext('Edit', {file_path: '/workspace/teams/team1/worker-bob/src/main.ts'});
    const result = await middleware.wrapToolCall!(ctx, passthrough);
    expect(String(result.content)).toContain('[PathGuard] Access denied');
  });

  test('allows non-file tools without checking', async () => {
    const ctx = makeContext('SomeOtherTool', {path: '/etc/secrets'});
    const result = await middleware.wrapToolCall!(ctx, passthrough);
    expect(result.content).toBe('ok');
  });

  test('allows worktree root path', async () => {
    const ctx = makeContext('Glob', {path: WORKTREE});
    const result = await middleware.wrapToolCall!(ctx, passthrough);
    expect(result.content).toBe('ok');
  });
});
