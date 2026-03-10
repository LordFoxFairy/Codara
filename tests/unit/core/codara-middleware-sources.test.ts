import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createMiddleware} from '@core/middleware';
import {createCodara} from '@core';
import {FakeModel, SystemEchoModel} from './codara-fixtures';

describe('Codara middleware source integration', () => {
  it('should inject session-loaded AGENTS.md into model calls', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-workspace-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});  // Mark as git root
    await mkdir(nestedCwd, {recursive: true});
    // Create AGENTS.md at the cwd level (nearest to where we're running)
    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      userHome,
      guidelines: true,
      skills: false,
      builtinTools: false,
      hil: false,
    });
    const result = await codara.invoke('hello');
    const text = String(result.state.messages[result.state.messages.length - 1]?.content);

    expect(text).toContain('AGENTS Guidelines');
    expect(text).toContain('project rule');
  });

  it('should let caller tool middleware short-circuit before default HIL', async () => {
    const toolCall: ToolCall = {id: 'call_1', name: 'echo', args: {text: 'ping'}};
    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done'),
    ]);
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong',
    } as unknown as StructuredToolInterface;
    const blocker = createMiddleware({
      name: 'BlockEchoMiddleware',
      wrapToolCall: async (context, handler) => {
        void handler;
        return new ToolMessage({
          content: 'blocked-before-hil',
          tool_call_id: context.toolCall.id ?? 'blocked',
          status: 'error',
        });
      },
    });

    const agent = createCodara({
      model: model as unknown as BaseChatModel,
      tools: [tool],
      skills: false,
      hil: {
        interruptOn: {
          echo: true,
        },
      },
      middlewares: [blocker],
    });

    const result = await agent.invoke('start');
    const toolMessage = result.state.messages.find((message: unknown) => message instanceof ToolMessage) as ToolMessage | undefined;

    expect(result.reason).toBe('complete');
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.content).toBe('blocked-before-hil');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('done');
  });
});
