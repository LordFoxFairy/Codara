import {describe, expect, it} from 'bun:test';
import {createAgentMemoryCheckpointer, createCodara, createCodaraRuntime} from '@/index';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EchoModel, StreamingEchoModel} from './codara-fixtures';

const createRuntimeForTest = (options: Parameters<typeof createCodaraRuntime>[0]) => (
  createCodaraRuntime({
    ...options,
    autoMemory: false,
  })
);

class DefaultRuntimeWorkflowModel {
  async invoke(messages: import('@langchain/core/messages').BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => String(message.content)).join('\n');

    if (text.includes('Inspect isolated child work') && !text.includes('Delegated task completed.')) {
      return new AIMessage('CHILD_FLOW_DONE');
    }

    if (text.includes('Delegated task completed.')) {
      return new AIMessage('RUNTIME_DEFAULT_FLOW_DONE');
    }

    if (text.includes('Task created.')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_default_task_delegate',
          name: 'Task',
          args: {
            prompt: 'Inspect isolated child work',
            subagent_type: 'general-purpose',
          },
        } as ToolCall],
      });
    }

    if (text.includes('Updated todo list to')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_default_task_create',
          name: 'TaskCreate',
          args: {
            subject: 'Inspect default runtime workflow',
            description: 'Track the delegated follow-up created by the default runtime entry.',
          },
        } as ToolCall],
      });
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_default_write_todos',
        name: 'write_todos',
        args: {
          todos: [
            {content: 'Inspect default runtime workflow', status: 'in_progress'},
            {content: 'Summarize the delegated result', status: 'pending'},
          ],
        },
      } as ToolCall],
    });
  }

  async *stream(messages: import('@langchain/core/messages').BaseMessage[]): AsyncGenerator<AIMessageChunk> {
    const message = await this.invoke(messages);
    yield new AIMessageChunk({
      content: message.content,
      ...(message.tool_calls ? {tool_calls: message.tool_calls} : {}),
    });
  }

  bindTools(): this {
    return this;
  }
}

class DefaultRuntimeProgressiveDisclosureModel {
  constructor(private readonly targetFile: string) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const delegatedResult = messages.find((message) => (
      ToolMessage.isInstance(message) && message.tool_call_id === 'call_runtime_progressive_delegate'
    )) as ToolMessage | undefined;

    if (messages.some((message) => HumanMessage.isInstance(message) && String(message.content).includes('Inspect deeper child feature'))) {
      const readResult = messages.find((message) => (
        ToolMessage.isInstance(message) && message.tool_call_id === 'call_runtime_progressive_read'
      )) as ToolMessage | undefined;

      if (!readResult) {
        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_runtime_progressive_read',
            name: 'read_file',
            args: {path: this.targetFile},
          } as ToolCall],
        });
      }

      const systemText = messages
        .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
        .map((message) => String(message.content))
        .join('\n');
      const runtimeInstructionText = messages
        .filter((message): message is HumanMessage => HumanMessage.isInstance(message))
        .map((message) => String(message.content))
        .join('\n');

      return new AIMessage(
        `CHILD_RUNTIME_DISCLOSURE:${runtimeInstructionText.includes('APP_RULE')
          || runtimeInstructionText.includes('APP_HANDBOOK')
          || systemText.includes('APP_RULE')
          || systemText.includes('APP_HANDBOOK')
        }`,
      );
    }

    if (delegatedResult) {
      return new AIMessage(`RUNTIME_DELEGATED_DISCLOSURE_DONE:${String(delegatedResult.content).includes('CHILD_RUNTIME_DISCLOSURE:true')}`);
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_runtime_progressive_delegate',
        name: 'Task',
        args: {
          prompt: 'Inspect deeper child feature',
          subagent_type: 'general-purpose',
        },
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

describe('Codara facade runtime', () => {
  it('should create a Codara session through the facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new EchoModel();

    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      sessionId: 'core-facade-session',
      checkpointer,
      skills: false,
    });

    const first = await codara.invoke('hello');
    expect(first.reason).toBe('complete');
    expect(String(first.state.messages[first.state.messages.length - 1]?.content)).toBe('seen_humans:1');

    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');
  });

  it('should expose a high-level invoke API through createCodara()', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.invoke('hello');
    expect(result.reason).toBe('complete');

    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');

    const agentState = codara.getAgentState();
    expect(agentState.messages).toHaveLength(2);
    expect(String(agentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should allow an async model without adding a second model entry path', async () => {
    const model = new EchoModel();
    const codara = createCodara({
      model: Promise.resolve(model as unknown as BaseChatModel),
      skills: false,
      builtinTools: false,
    });

    const result = await codara.invoke('hello');
    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('seen_humans:1');
  });

  it('should not require a home config when an explicit model is provided', async () => {
    const originalHome = process.env.HOME;
    const originalCodaraPath = process.env.CODARA_PATH;
    const isolatedHome = await mkdtemp(path.join(tmpdir(), 'codara-no-home-config-'));

    process.env.HOME = isolatedHome;
    delete process.env.CODARA_PATH;

    try {
      const codara = createCodara({
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('hello');
      expect(result.reason).toBe('complete');
      expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('seen_humans:1');
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }

      if (originalCodaraPath === undefined) {
        delete process.env.CODARA_PATH;
      } else {
        process.env.CODARA_PATH = originalCodaraPath;
      }

      await rm(isolatedHome, {recursive: true, force: true});
    }
  });

  it('should recreate the agent after reset', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('hello');
    await codara.reset();

    const result = await codara.invoke('again');
    expect(result.reason).toBe('complete');

    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');

    const agentState = codara.getAgentState();
    expect(agentState.messages).toHaveLength(2);
    expect(String(agentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should stream through the top-level Codara facade for CLI consumers', async () => {
    const model = new StreamingEchoModel();
    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.stream('hello', {streamMode: 'messages'})) {
      const messageChunk = chunk as AIMessageChunk;
      chunks.push(String(messageChunk.content));
    }

    expect(chunks).toEqual(['seen_humans:1']);
    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');

    const agentState = codara.getAgentState();
    expect(agentState.messages).toHaveLength(2);
    expect(String(agentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should discover global skill commands from the top-level userHome option', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-global-skills-home-'));
    const cwd = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const skillDir = path.join(userHome, '.codara', 'skills', 'review-helper');

    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: review-helper
description: Review helper skill
command-name: review-helper
---
# Review helper
`, 'utf8');

    try {
      const codara = createCodara({
        cwd,
        projectRoot: cwd,
        userHome,
        model: new EchoModel() as unknown as BaseChatModel,
        builtinTools: false,
      });

      const commands = await codara.listCommands();
      expect(commands.map((command) => command.name)).toContain('review-helper');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should provide a core-owned persistent runtime entry for CLI consumers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-entry-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');

    await mkdir(cwd, {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    try {
      const codara = await createRuntimeForTest({
        cwd,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('hello');
      expect(result.reason).toBe('complete');

      const sessionId = codara.getState().sessionId;

      await expect(stat(path.join(codaraRoot, 'sessions', sessionId, 'metadata.json'))).resolves.toBeDefined();
      await expect(stat(path.join(codaraRoot, 'sessions', sessionId, 'checkpoints', 'latest.json'))).resolves.toBeDefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should write runtime logs to project .codara/sessions/<sessionId>/logs/YYYY-MM-DD.log by default', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-logs-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');

    await mkdir(cwd, {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    try {
      const codara = await createRuntimeForTest({
        cwd,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('hello');
      expect(result.reason).toBe('complete');

      const sessionId = codara.getState().sessionId;
      const logPath = path.join(codaraRoot, 'sessions', sessionId, 'logs', `${new Date().toISOString().slice(0, 10)}.log`);
      const content = await readFile(logPath, 'utf8');
      const records = content.trim().split('\n').map((line) => JSON.parse(line));

      expect(records.length).toBeGreaterThan(0);
      expect(records.every((record) => record.sessionId === sessionId)).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should include AskUser interaction capability in the default runtime entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-ask-user-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');

    await mkdir(cwd, {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    class AskUserModel {
      async invoke(messages: import('@langchain/core/messages').BaseMessage[]): Promise<AIMessage> {
        const existingResult = messages.find((message) => (
          ToolMessage.isInstance(message) && String(message.content).includes('"action":"submit"')
        ));
        if (existingResult) {
          return new AIMessage('ASK_USER_DONE');
        }

        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_runtime_ask_user',
            name: 'AskUserQuestion',
            args: {
              summary: 'Need one critical product answer before planning continues.',
              questions: [{id: 'domain', label: 'Domain', question: 'Which domain?'}],
            },
          } as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }

    try {
      const codara = await createRuntimeForTest({
        cwd,
        model: new AskUserModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const paused = await codara.invoke('plan this product');
      expect(paused.reason).toBe('complete');
      expect(paused.state.status).toBe('paused');
      expect(paused.state.pendingPause?.action.toolName).toBe('AskUserQuestion');
      expect(paused.state.pendingPause?.ui?.form?.tabs[0]?.label).toBe('Domain');

      const resumed = await codara.resumePause({
        action: 'submit',
        metadata: {
          form: {
            answers: {
              domain: 'SaaS',
            },
          },
        },
      });
      expect(String(resumed.state.messages[resumed.state.messages.length - 1]?.content)).toBe('ASK_USER_DONE');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should include todo, shared tasks, and Task delegation in the default runtime entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-default-workflow-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');

    await mkdir(cwd, {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    try {
      const codara = await createRuntimeForTest({
        cwd,
        model: new DefaultRuntimeWorkflowModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('run the default runtime workflow');
      expect(result.reason).toBe('complete');
      expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('RUNTIME_DEFAULT_FLOW_DONE');

      const taskDir = path.join(codaraRoot, 'tasks');
      const taskFiles = await stat(taskDir);
      expect(taskFiles.isDirectory()).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should keep delegated runtime children on the startup instruction chain after reading deeper files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-progressive-child-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');
    const targetFile = path.join(cwd, 'packages', 'app', 'src', 'feature.ts');

    await mkdir(path.join(cwd, '.git'), {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await mkdir(path.join(cwd, 'packages', 'app', '.codara'), {recursive: true});
    await mkdir(path.dirname(targetFile), {recursive: true});
    await writeFile(path.join(cwd, 'AGENTS.md'), 'ROOT_RULE', 'utf8');
    await writeFile(path.join(cwd, 'packages', 'app', 'AGENTS.md'), 'APP_RULE', 'utf8');
    await writeFile(path.join(codaraRoot, 'codara.md'), 'ROOT_HANDBOOK', 'utf8');
    await writeFile(path.join(cwd, 'packages', 'app', '.codara', 'codara.md'), 'APP_HANDBOOK', 'utf8');
    await writeFile(targetFile, 'export const feature = true;\n', 'utf8');
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    try {
      const codara = await createRuntimeForTest({
        cwd,
        model: new DefaultRuntimeProgressiveDisclosureModel(targetFile) as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
        tools: [
          tool(async ({path: filePath}: {path: string}) => readFile(filePath, 'utf8'), {
            name: 'read_file',
            description: 'Read a file for runtime delegated disclosure tests.',
            schema: z.object({path: z.string()}),
          }),
        ],
      });

      const result = await codara.invoke('run delegated progressive disclosure');
      expect(result.reason).toBe('complete');
      expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('RUNTIME_DELEGATED_DISCLOSURE_DONE:false');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should default sessionId and sessionId to the same identity source', () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const state = codara.getState();
    expect(state.sessionId).toBe(state.sessionId);
  });

  it('should accept a unified id for the public session identity', () => {
    const codara = createCodara({
      id: 'shared-id',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const state = codara.getState();
    expect(state.sessionId).toBe('shared-id');
    expect(state.sessionId).toBe('shared-id');
  });
});
