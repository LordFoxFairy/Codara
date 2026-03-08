import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createMiddleware, MiddlewarePipeline, type ModelCallContext} from '@core/middleware';
import {createCodaraAgent, createCodaraMiddlewares} from '@core';
import {loadCodaraSourceStack} from '@core/codara/sources';
import {FakeModel} from './codara-fixtures';

describe('Codara middleware source integration', () => {
  it('should resolve AGENTS.md and MEMORY.md from the workspace root derived from cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-workspace-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory', 'utf8');

    const loadedSources = await loadCodaraSourceStack({
      cwd: nestedCwd,
      guidelines: {userHome},
      memory: {userHome},
      skills: false,
      hil: false,
    });
    const pipeline = new MiddlewarePipeline(
      createCodaraMiddlewares(
        {
          cwd: nestedCwd,
          guidelines: {userHome},
          memory: {userHome},
          skills: false,
          hil: false,
        },
        loadedSources,
      ),
    );
    const context: ModelCallContext = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, agentContext: {}},
      systemMessage: ['base system'],
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req_1',
    };

    const response = await pipeline.wrapModelCall(context, async (request) => {
      expect(request?.systemMessage).toHaveLength(3);
      expect(request?.systemMessage[1]).toContain('AGENTS Guidelines');
      expect(request?.systemMessage[1]).toContain('project rule');
      expect(request?.systemMessage[2]).toContain('Project Memory');
      expect(request?.systemMessage[2]).toContain('project memory');
      return new AIMessage('ok');
    });

    expect(response.content).toBe('ok');
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

    const agent = await createCodaraAgent({
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
    const toolMessage = result.state.messages.find((message) => message instanceof ToolMessage) as ToolMessage | undefined;

    expect(result.reason).toBe('complete');
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.content).toBe('blocked-before-hil');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('done');
  });
});
