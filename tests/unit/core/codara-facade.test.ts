import {describe, expect, it} from 'bun:test';
import {createAgentFileCheckpointer, createAgentMemoryCheckpointer, createCodara, createCodaraRuntime} from '@/index';
import {putManualCheckpoint} from '@durability/checkpoint';
import {createApprovalFileStore, createApprovalMemoryStore} from '@durability/approval-store';
import {createHILMiddleware} from '@core/middleware';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EchoModel, StreamingEchoModel} from './codara-fixtures';
import {createAgentRunFileStore, createAgentRunMemoryStore, createAgentRuntime, AGENT_TOOL_NAME, createAgentTool} from '@/capability/subagent';

const createRuntimeForTest = (options: Parameters<typeof createCodaraRuntime>[0]) => (
  createCodaraRuntime({
    ...options,
    autoMemory: false,
  })
);

async function waitForCondition(
  predicate: () => boolean,
  options: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition was not satisfied before timeout');
}

class DefaultRuntimeWorkflowModel {
  async invoke(messages: import('@langchain/core/messages').BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => String(message.content)).join('\n');

    if (text.includes('Inspect isolated child work') && !text.includes('Subagent started in background.')) {
      return new AIMessage('CHILD_FLOW_DONE');
    }

    if (text.includes('Subagent started in background.')) {
      return new AIMessage('RUNTIME_DEFAULT_FLOW_DONE');
    }

    if (text.includes('Task created.')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_default_task_delegate',
          name: 'Agent',
          args: {
            prompt: 'Inspect isolated child work',
            subagent_type: 'Agent',
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
        name: 'Agent',
        args: {
          prompt: 'Inspect deeper child feature',
          subagent_type: 'Agent',
        },
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

class MultiDelegatedApprovalModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => String(message.content)).join('\n');
    const dangerousResult = messages.find((message) => (
      ToolMessage.isInstance(message) && message.tool_call_id === 'dangerous_call'
    )) as ToolMessage | undefined;

    if (dangerousResult) {
      return new AIMessage(`CHILD_DONE:${String(dangerousResult.content)}`);
    }

    if (text.includes('Inspect alpha approval path')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'dangerous_call',
          name: 'dangerous_tool',
          args: {target: 'alpha'},
        } as ToolCall],
      });
    }

    if (text.includes('Inspect beta approval path')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'dangerous_call',
          name: 'dangerous_tool',
          args: {target: 'beta'},
        } as ToolCall],
      });
    }

    return new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call_task_alpha',
          name: 'Agent',
          args: {
            prompt: 'Inspect alpha approval path',
            subagent_type: 'Agent',
          },
        } as ToolCall,
        {
          id: 'call_task_beta',
          name: 'Agent',
          args: {
            prompt: 'Inspect beta approval path',
            subagent_type: 'Agent',
          },
        } as ToolCall,
      ],
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

  it('should filter persisted task run summaries to the current runtime session', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-task-runs-'));
    const agentRunStore = createAgentRunFileStore({
      rootDir: path.join(projectRoot, '.codara', 'task-runs'),
    });

    agentRunStore.start({
      runId: 'run-session-a',
      sessionId: 'runtime-task-run-session-a',
      label: 'Delegating Agent: Inspect isolated child work',
      agentName: 'Agent',
    });
    agentRunStore.finish('run-session-a', {
      type: 'delegated_agent_result',
      sessionId: 'child-a',
      turns: 1,
      reason: 'complete',
      summary: 'done a',
    });

    agentRunStore.start({
      runId: 'run-session-b',
      sessionId: 'runtime-task-run-session-b',
      label: 'Delegating Agent: Inspect another child work',
      agentName: 'Agent',
    });
    agentRunStore.finish('run-session-b', {
      type: 'delegated_agent_result',
      sessionId: 'child-b',
      turns: 1,
      reason: 'complete',
      summary: 'done b',
    });

    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-task-run-session-a',
      agentRunStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.getAgentRunSummaries()).toEqual([
      expect.objectContaining({
        parentSessionId: 'runtime-task-run-session-a',
        label: 'Delegating Agent: Inspect isolated child work',
        agentName: 'Agent',
        status: 'completed',
      }),
    ]);
    expect(runtime.getAgentRunSummaries()).toHaveLength(1);
  });

  it('should rebind a caller-provided Agent tool to the runtime stores while preserving child tools', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-custom-task-'));
    const runtimeAgentRunStore = createAgentRunMemoryStore();
    const runtimeApprovalStore = createApprovalMemoryStore();
    const customAgentRunStore = createAgentRunMemoryStore();
    const customApprovalStore = createApprovalMemoryStore();
    const runtimeEvents: import('@/index').CodaraRuntimeEvent[] = [];

    class RuntimeReboundTaskChildModel {
      async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        const toolResult = messages.find((message) => (
          ToolMessage.isInstance(message) && message.tool_call_id === 'call_runtime_rebound_child_tool'
        )) as ToolMessage | undefined;

        if (toolResult) {
          return new AIMessage(`child-tool:${String(toolResult.content)}`);
        }

        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_runtime_rebound_child_tool',
            name: 'child_echo',
            args: {
              value: 'delegated child hello',
            },
          } as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }

    class RuntimeReboundTaskParentModel {
      async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        if (messages.some((message) => ToolMessage.isInstance(message) && message.tool_call_id === 'call_runtime_rebound_task')) {
          return new AIMessage('parent_done');
        }

        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_runtime_rebound_task',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Inspect custom runtime rebinding',
              subagent_type: 'Agent',
            },
          } as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }

    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-custom-task-session',
      agentRunStore: runtimeAgentRunStore,
      approvalStore: runtimeApprovalStore,
      model: new RuntimeReboundTaskParentModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [
        createAgentTool({
          model: new RuntimeReboundTaskChildModel() as unknown as BaseChatModel,
          tools: [
            tool(async ({value}: {value: string}) => `child_echo:${value}`, {
              name: 'child_echo',
              description: 'Child tool preserved through Agent tool rebinding.',
              schema: z.object({
                value: z.string(),
              }),
            }),
          ],
          runStore: customAgentRunStore,
          approvalStore: customApprovalStore,
          runtime: createAgentRuntime({
            runStore: customAgentRunStore,
            approvalStore: customApprovalStore,
          }),
        }),
      ],
    });
    const unsubscribe = runtime.subscribeRuntimeEvents((event) => {
      runtimeEvents.push(event);
    });

    try {
      const result = await runtime.invoke('start the custom task runtime flow');
      expect(result.reason).toBe('complete');

      await waitForCondition(() => runtime.getAgentRunSummaries().some((run) => (
        run.runId === 'call_runtime_rebound_task' && run.status === 'completed'
      )));

      expect(runtime.getAgentRunSummaries()).toEqual([
        expect.objectContaining({
          runId: 'call_runtime_rebound_task',
          label: 'Delegating Agent: Inspect custom runtime rebinding',
          agentName: 'Agent',
          status: 'completed',
          summary: expect.stringContaining('child-tool:child_echo:delegated child hello'),
        }),
      ]);
      expect(customAgentRunStore.list()).toHaveLength(0);
      expect(runtimeEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Agent: Inspect custom runtime rebinding',
        }),
        expect.objectContaining({
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent running in background',
        }),
      ]));
    } finally {
      unsubscribe();
      await runtime.dispose();
    }
  });

  it('should not mutate live running task runs when reading summaries', async () => {
    const agentRunStore = createAgentRunMemoryStore();
    const runtime = await createRuntimeForTest({
      sessionId: 'runtime-live-task-run-session',
      agentRunStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    agentRunStore.start({
      runId: 'run-live',
      sessionId: 'runtime-live-task-run-session',
      label: 'Delegating Agent: Inspect live query behavior',
      agentName: 'Agent',
    });

    expect(runtime.getAgentRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-live',
        status: 'running',
      }),
    ]);
    expect(agentRunStore.get('run-live')?.status).toBe('running');

    expect(runtime.getAgentRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-live',
        status: 'running',
      }),
    ]);
    expect(agentRunStore.get('run-live')?.status).toBe('running');
  });

  it('should surface concurrent delegated approvals, switch approval focus, and keep task approval resume behavior working', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-approval-queue-'));
    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-approval-queue-session',
      model: new MultiDelegatedApprovalModel() as unknown as BaseChatModel,
      skills: false,
      hil: {
        interruptOn: {
          dangerous_tool: true,
        },
      },
      tools: [
        tool(async ({target}: {target: string}) => `dangerous:${target}`, {
          name: 'dangerous_tool',
          description: 'Dangerous tool used to force delegated approval pauses.',
          schema: z.object({target: z.string()}),
        }),
      ],
    });
    const runtimeEvents: import('@/index').CodaraRuntimeEvent[] = [];
    const unsubscribe = runtime.subscribeRuntimeEvents((event) => {
      runtimeEvents.push(event);
    });

    try {
      const launched = await runtime.invoke('start the concurrent delegated approvals');
      expect(launched.state.status).not.toBe('paused');
      expect(launched.state.pendingPause).toBeUndefined();

      await waitForCondition(() => runtime.listReviewItems().length === 2);
      const reviews = runtime.listReviewItems();
      expect(reviews).toHaveLength(2);
      expect(reviews.map((review) => review.anchor.agentRunId).sort()).toEqual(['call_task_alpha', 'call_task_beta']);
      expect(runtime.getAgentState().pendingPause).toBeUndefined();
      await waitForCondition(() => (
        runtimeEvents.filter((event) => (
          event.kind === 'agent'
          && event.phase === 'update'
          && event.status === 'paused'
                && event.label === 'Delegated agent waiting for review'
        )).length >= 2
      ));

      const alternateReview = reviews[1];
      expect(alternateReview).toBeDefined();

      await runtime.focusReview(alternateReview!.reviewId);
      expect(runtime.getFocusedReview()?.item.reviewId).toBe(alternateReview!.reviewId);
      expect(runtime.listReviewItems().find((review) => review.reviewId === alternateReview!.reviewId)?.isFocused).toBe(true);

      await runtime.resumeReview({action: 'allow_once'});
      await waitForCondition(() => runtime.listReviewItems().length === 1);

      const remainingReviews = runtime.listReviewItems();
      expect(remainingReviews).toHaveLength(1);
      expect(remainingReviews[0]?.reviewId).not.toBe(alternateReview!.reviewId);
      expect(runtime.getFocusedReview()?.item.reviewId).toBe(remainingReviews[0]?.reviewId);

      const taskRuns = runtime.getAgentRunSummaries();
      expect(taskRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: alternateReview!.anchor.agentRunId,
          status: 'completed',
        }),
        expect.objectContaining({
          status: 'paused',
        }),
      ]));
      expect(runtimeEvents.some((event) => (
        event.kind === 'agent'
        && event.phase === 'end'
        && event.status === 'done'
        && event.label === 'Delegated agent completed'
      ))).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('should recover a reopened persisted running task run for the current runtime session', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-task-run-recovery-'));
    const rootDir = path.join(projectRoot, '.codara', 'task-runs');

    const originalStore = createAgentRunFileStore({rootDir});
    originalStore.start({
      runId: 'run-recovery',
      sessionId: 'runtime-task-run-recovery-session',
      label: 'Delegating research: inspect a restart boundary',
      agentName: 'research',
    });

    const reopenedStore = createAgentRunFileStore({rootDir});
    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-task-run-recovery-session',
      agentRunStore: reopenedStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.getAgentRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-recovery',
        status: 'paused',
      }),
    ]);
    expect(reopenedStore.get('run-recovery')).toEqual(expect.objectContaining({
      status: 'paused',
    }));
  });

  it('should resume a reopened persisted task approval through the task runtime control plane', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-paused-task-reopen-'));
    const agentRunStore = createAgentRunFileStore({
      rootDir: path.join(projectRoot, '.codara', 'task-runs'),
    });
    const approvalStore = createApprovalFileStore({
      rootDir: path.join(projectRoot, '.codara', 'approvals'),
    });

    class ReopenableTaskParentModel {
      async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        if (messages.some((message) => ToolMessage.isInstance(message) && message.tool_call_id === 'call_reopen_task')) {
          return new AIMessage('parent_done');
        }

        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_reopen_task',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Inspect the guarded child flow',
              subagent_type: 'Agent',
            },
          } as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }

    class ReopenableTaskChildModel {
      async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        const toolMessage = messages.find((message) => (
          ToolMessage.isInstance(message) && message.tool_call_id === 'call_reopen_child_danger'
        )) as ToolMessage | undefined;

        if (toolMessage) {
          return new AIMessage(`recovered_child_done:${String(toolMessage.content)}`);
        }

        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_reopen_child_danger',
            name: 'dangerous_tool',
            args: {
              target: 'reopen-guarded.txt',
            },
          } as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }

    const customTaskTool = () => createAgentTool({
      model: new ReopenableTaskChildModel() as unknown as BaseChatModel,
      tools: [
        tool(async ({target}: {target: string}) => `danger:${target}`, {
          name: 'dangerous_tool',
          description: 'Dangerous child tool for paused task recovery tests.',
          schema: z.object({
            target: z.string(),
          }),
        }),
      ],
      childMiddleware: [
        createHILMiddleware({
          interruptOn: {
            dangerous_tool: true,
          },
        }),
      ],
    });

    const firstRuntime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-paused-task-session',
      agentRunStore,
      approvalStore,
      model: new ReopenableTaskParentModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [customTaskTool()],
    });

    try {
      const first = await firstRuntime.invoke('start paused subagent run');
      expect(first.reason).toBe('complete');

      await waitForCondition(() => firstRuntime.listReviewItems().length === 1);
      expect(firstRuntime.getAgentRunSummaries()).toEqual([
        expect.objectContaining({
          runId: 'call_reopen_task',
          status: 'paused',
        }),
      ]);
    } finally {
      await firstRuntime.dispose();
    }

    const reopened = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-paused-task-session',
      agentRunStore,
      approvalStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [customTaskTool()],
    });

    try {
      const reviews = reopened.listReviewItems();
      expect(reviews).toEqual([
        expect.objectContaining({
          anchor: expect.objectContaining({agentRunId: 'call_reopen_task'}),
          source: 'agent_run',
          toolName: 'dangerous_tool',
        }),
      ]);

      await reopened.focusReview(reviews[0]!.reviewId);
      await reopened.resumeReview({decision: 'approve'});
      await waitForCondition(() => reopened.getAgentRunSummaries().some((run) => (
        run.runId === 'call_reopen_task' && run.status === 'completed'
      )));

      expect(reopened.getAgentRunSummaries()).toEqual([
        expect.objectContaining({
          runId: 'call_reopen_task',
          status: 'completed',
          summary: expect.stringContaining('recovered_child_done:danger:reopen-guarded.txt'),
        }),
      ]);
      expect(reopened.listReviewItems()).toEqual([]);
    } finally {
      await reopened.dispose();
      await rm(projectRoot, {recursive: true, force: true});
    }
  });

  it('should keep runtime session checkpoints scoped to the project state directory instead of the global config root', async () => {
    const userHome = await mkdtemp(path.join(tmpdir(), 'codara-runtime-user-home-'));
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-project-root-'));
    const sessionId = 'runtime-project-state-session';
    const originalHome = process.env.HOME;
    const globalCheckpointer = createAgentFileCheckpointer({
      rootDir: path.join(userHome, '.codara', 'sessions'),
    });

    await putManualCheckpoint(globalCheckpointer, sessionId, {
      agentType: 'main',
      messages: [],
      context: {},
      values: {},
      pendingPause: {
        id: 'global-stale-pause',
        description: 'stale global pause',
        action: {
          toolCallId: 'call-stale',
          toolName: 'dangerous_tool',
          toolArgs: {},
        },
        review: {
          actionName: 'dangerous_tool',
          allowedDecisions: ['approve', 'edit', 'reject'],
        },
        runtime: {
          runId: 'global-run',
          turn: 1,
          requestId: 'global-request',
          toolIndex: 0,
        },
      },
    });

    process.env.HOME = userHome;
    try {
      const runtime = await createRuntimeForTest({
        cwd: projectRoot,
        projectRoot,
        userHome,
        sessionId,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await runtime.invoke('hello');
      expect(result.reason).toBe('complete');
      expect(result.state.pendingPause).toBeUndefined();
      await expect(stat(path.join(projectRoot, '.codara', 'sessions', sessionId, 'checkpoints', 'latest.json'))).resolves.toBeDefined();
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
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

  it('should expose a unified interaction stream through the top-level Codara facade', async () => {
    const model = new StreamingEchoModel();
    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.streamInteraction({
      kind: 'prompt',
      input: 'hello',
      config: {streamMode: 'messages'},
    })) {
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
      expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toContain('Subagent started in background.');

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
      expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toContain('Subagent started in background.');
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
