import {describe, expect, it} from 'bun:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AIMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {
  createAgentMemoryCheckpointer,
  createAskUserTool,
  createCodaraRuntime,
  createAskUserQuestionMiddleware,
  createSession,
} from '@/index';
import {createAutoMemoryRuntime, resolveAutoMemoryRoot} from '@infra/context/memory/auto-memory';

describe('runtime auto memory cases', () => {
  it('writes global auto memory after a successful main-agent turn by default', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-auto-memory-global-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const codara = await createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      userHome,
      codaraPath: path.join(projectRoot, '.codara'),
      model: new StaticResponseModel('Saved a useful learning about the lint workflow.') as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    const result = await codara.invoke('Remember the lint workflow for future runs');
    expect(result.reason).toBe('complete');

    const memoryRoot = resolveAutoMemoryRoot({projectRoot, userHome});
    expect(existsSync(path.join(memoryRoot, 'MEMORY.md'))).toBe(true);
    expect((await readdir(path.join(memoryRoot, 'topics'))).length).toBeGreaterThan(0);
  });

  it('writes project-scoped auto memory when memory.autoGlobal is disabled in project settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-auto-memory-project-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(
      path.join(projectRoot, '.codara', 'settings.json'),
      JSON.stringify({memory: {autoGlobal: false}}, null, 2),
      'utf8',
    );

    const codara = await createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      userHome,
      codaraPath: path.join(projectRoot, '.codara'),
      model: new StaticResponseModel('Stored a project-local learning.') as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    const result = await codara.invoke('Remember this only for the current project');
    expect(result.reason).toBe('complete');

    expect(existsSync(path.join(projectRoot, '.codara', 'memory', 'MEMORY.md'))).toBe(true);
    const globalRoot = resolveAutoMemoryRoot({projectRoot, userHome, autoGlobal: true});
    expect(existsSync(path.join(globalRoot, 'MEMORY.md'))).toBe(false);
  });

  it('does not write auto memory for paused turns', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-auto-memory-paused-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const codara = await createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      userHome,
      codaraPath: path.join(projectRoot, '.codara'),
      model: new AskUserModel() as unknown as BaseChatModel,
      tools: [createAskUserTool()],
      middleware: [createAskUserQuestionMiddleware()],
      builtinTools: false,
      skills: false,
      hil: false,
    });

    const result = await codara.invoke('I need clarification before you continue');
    expect(result.state.pendingPause).toBeDefined();

    const memoryRoot = resolveAutoMemoryRoot({projectRoot, userHome});
    expect(existsSync(path.join(memoryRoot, 'MEMORY.md'))).toBe(false);
  });

  it('does not write auto memory for failed turns', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-auto-memory-error-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const codara = await createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      userHome,
      codaraPath: path.join(projectRoot, '.codara'),
      model: new ThrowingModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    const result = await codara.invoke('This turn should fail');
    expect(result.reason).toBe('error');

    const memoryRoot = resolveAutoMemoryRoot({projectRoot, userHome});
    expect(existsSync(path.join(memoryRoot, 'MEMORY.md'))).toBe(false);
  });

  it('does not write auto memory for slash-command-only turns', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-auto-memory-command-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const codara = await createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      userHome,
      codaraPath: path.join(projectRoot, '.codara'),
      model: new StaticResponseModel('UNUSED') as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    const result = await codara.executeCommand('/status');
    expect(result.ok).toBe(true);

    const memoryRoot = resolveAutoMemoryRoot({projectRoot, userHome});
    expect(existsSync(path.join(memoryRoot, 'MEMORY.md'))).toBe(false);
  });

  it('does not write auto memory for subagent sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-auto-memory-subagent-'));
    const memoryRoot = path.join(root, 'memory');
    const sessionId = 'subagent-session';
    const checkpointer = createAgentMemoryCheckpointer();
    await checkpointer.put({
      sessionId,
      state: {
        agentType: 'subagent',
        messages: [],
        context: {},
        values: {},
      },
      info: {
        source: 'manual',
        status: 'idle',
        reason: 'complete',
        turns: 0,
        step: 0,
        createdAt: new Date().toISOString(),
      },
    });

    const session = createSession({
      sessionId,
      model: new StaticResponseModel('Child agent finished.') as unknown as BaseChatModel,
      restore: 'latest',
      checkpointer,
      autoMemory: createAutoMemoryRuntime({rootDir: memoryRoot}),
    });

    const result = await session.invoke('child task');
    expect(result.reason).toBe('complete');
    expect(result.state.agentType).toBe('subagent');
    expect(existsSync(path.join(memoryRoot, 'MEMORY.md'))).toBe(false);
  });
});

class StaticResponseModel {
  constructor(private readonly content: string) {}

  async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
    void _messages;
    return new AIMessage(this.content);
  }

  bindTools(): this {
    return this;
  }
}

class ThrowingModel {
  async invoke(): Promise<AIMessage> {
    throw new Error('MODEL_FAILURE');
  }

  bindTools(): this {
    return this;
  }
}

class AskUserModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const sawToolResponse = messages.some((message) => String(message.content).includes('hil_pause'));
    if (sawToolResponse) {
      return new AIMessage('UNEXPECTED_RESUME');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_auto_memory_ask',
        name: 'AskUserQuestion',
        args: {
          summary: 'Need one clarification before continuing.',
          questions: [
            {
              id: 'scope',
              label: 'Scope',
              question: 'What scope should the agent target?',
              options: [
                {id: 'mvp', label: 'MVP', description: 'Keep it intentionally small.'},
              ],
            },
          ],
        },
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}
