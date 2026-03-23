import {describe, expect, it} from 'bun:test';
import {createAgentFileCheckpointer, createAgentMemoryCheckpointer, createCodara, createCodaraRuntime} from '@/index';
import {putManualCheckpoint} from '@durability/checkpoint';
import {createApprovalFileStore, createApprovalMemoryStore} from '@durability/approval-store';
import {createReviewMiddleware} from '@core/middleware';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EchoModel, StreamingEchoModel} from './codara-fixtures';
import {createSubagentRunFileStore, createSubagentRunMemoryStore, createSubagentMiddleware} from '@/capability/subagent';
import {AGENT_TOOL_NAME} from '@/capability/subagent/tool';

const createRuntimeForTest = (options: Parameters<typeof createCodaraRuntime>[0]) => (
  createCodaraRuntime({
    ...options,
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

class StreamingSubagentFollowThroughParentModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');
    const transcriptText = messages.map((message) => String(message.content)).join('\n');

    if (systemText.includes('Completed subagent runs from your previous response are now available.')) {
      return new AIMessage('FINAL_FROM_MAIN');
    }

    if (transcriptText.includes('delegate please')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_stream_followthrough_agent',
          name: 'Agent',
          args: {
            prompt: 'Inspect repository structure',
            subagent_type: 'Agent',
          },
        } as ToolCall],
      });
    }

    return new AIMessage('UNEXPECTED_PARENT_RESPONSE');
  }

  async *stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
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

class StreamingSubagentFollowThroughChildModel {
  async invoke(): Promise<AIMessage> {
    return new AIMessage('CHILD_DONE');
  }

  async *stream(): AsyncGenerator<AIMessageChunk> {
    yield new AIMessageChunk({content: 'CHILD_DONE'});
  }

  bindTools(): this {
    return this;
  }
}

const RAW_CHILD_REPORT = [
  'src/cli 目录架构分析报告',
  '',
  '1. 目录结构',
  'src/cli/',
  '├── app/',
  '└── components/',
].join('\n');

class StreamingSubagentVerboseChildModel {
  async invoke(): Promise<AIMessage> {
    return new AIMessage(RAW_CHILD_REPORT);
  }

  async *stream(): AsyncGenerator<AIMessageChunk> {
    yield new AIMessageChunk({content: RAW_CHILD_REPORT});
  }

  bindTools(): this {
    return this;
  }
}

class StreamingSubagentRetryingParentModel {
  private completionAttempts = 0;

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');
    const transcriptText = messages.map((message) => String(message.content)).join('\n');

    if (systemText.includes('Completed subagent runs from your previous response are now available.')) {
      this.completionAttempts += 1;
      if (this.completionAttempts === 1) {
        return new AIMessage('Phase 1 has started. Waiting for subagent results.');
      }
      return new AIMessage('FINAL_AFTER_RETRY');
    }

    if (transcriptText.includes('delegate with retry')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_stream_retry_agent',
          name: 'Agent',
          args: {
            prompt: 'Inspect repository structure',
            subagent_type: 'Agent',
          },
        } as ToolCall],
      });
    }

    return new AIMessage('UNEXPECTED_RETRY_PARENT_RESPONSE');
  }

  async *stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
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

class StreamingSubagentOrchestrationRetryingParentModel {
  private completionAttempts = 0;

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');
    const transcriptText = messages.map((message) => String(message.content)).join('\n');

    if (systemText.includes('Completed subagent runs from your previous response are now available.')) {
      this.completionAttempts += 1;
      if (this.completionAttempts === 1) {
        return new AIMessage('两个 subagent 都已完成！现在让我汇总它们的发现，提炼出当前架构最核心的边界：');
      }
      return new AIMessage('FINAL_AFTER_ORCHESTRATION_RETRY');
    }

    if (transcriptText.includes('delegate orchestration retry')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_stream_orchestration_retry_agent',
          name: 'Agent',
          args: {
            prompt: 'Inspect repository structure',
            subagent_type: 'Agent',
          },
        } as ToolCall],
      });
    }

    return new AIMessage('UNEXPECTED_ORCHESTRATION_PARENT_RESPONSE');
  }

  async *stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
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

class StreamingSubagentRawReplayRetryingParentModel {
  private completionAttempts = 0;

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');
    const transcriptText = messages.map((message) => String(message.content)).join('\n');

    if (systemText.includes('Completed subagent runs from your previous response are now available.')) {
      this.completionAttempts += 1;
      if (this.completionAttempts === 1) {
        return new AIMessage(RAW_CHILD_REPORT);
      }
      return new AIMessage('FINAL_AFTER_RAW_REPLAY_RETRY');
    }

    if (transcriptText.includes('delegate raw replay')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_stream_raw_replay_agent',
          name: 'Agent',
          args: {
            prompt: 'Inspect repository structure',
            subagent_type: 'Agent',
          },
        } as ToolCall],
      });
    }

    return new AIMessage('UNEXPECTED_RAW_REPLAY_PARENT_RESPONSE');
  }

  async *stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
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
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-agent-runs-'));
    const subagentRunStore = createSubagentRunFileStore({
      rootDir: path.join(projectRoot, '.codara', 'agent-runs'),
    });

    subagentRunStore.start({
      runId: 'run-session-a',
      parentSessionId: 'runtime-agent-run-session-a',
      label: 'Delegating Agent: Inspect isolated child work',
      agentName: 'Agent',
    });
    subagentRunStore.finish('run-session-a', {
      type: 'subagent_result',
      sessionId: 'child-a',
      turns: 1,
      reason: 'complete',
      summary: 'done a',
    });

    subagentRunStore.start({
      runId: 'run-session-b',
      parentSessionId: 'runtime-agent-run-session-b',
      label: 'Delegating Agent: Inspect another child work',
      agentName: 'Agent',
    });
    subagentRunStore.finish('run-session-b', {
      type: 'subagent_result',
      sessionId: 'child-b',
      turns: 1,
      reason: 'complete',
      summary: 'done b',
    });

    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-agent-run-session-a',
      subagentRunStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.getSubagentRunSummaries()).toEqual([
      expect.objectContaining({
        parentSessionId: 'runtime-agent-run-session-a',
        label: 'Delegating Agent: Inspect isolated child work',
        agentName: 'Agent',
        status: 'completed',
      }),
    ]);
    expect(runtime.getSubagentRunSummaries()).toHaveLength(1);
    expect(runtime.getSubagentRunSummaries()[0]).not.toHaveProperty('sessionId');
  });

  it('should accept a caller-provided Agent middleware while preserving child tools', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-custom-task-'));
    const runtimeSubagentRunStore = createSubagentRunMemoryStore();
    const runtimeApprovalStore = createApprovalMemoryStore();
    const customSubagentRunStore = createSubagentRunMemoryStore();
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
      subagentRunStore: runtimeSubagentRunStore,
      approvalStore: runtimeApprovalStore,
      model: new RuntimeReboundTaskParentModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      middleware: [
        createSubagentMiddleware({
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
        }),
      ],
    });
    const unsubscribe = runtime.subscribeRuntimeEvents((event) => {
      runtimeEvents.push(event);
    });

    try {
      const result = await runtime.invoke('start the custom task runtime flow');
      expect(result.reason).toBe('complete');

      await waitForCondition(() => runtime.getSubagentRunSummaries().some((run) => (
        run.runId === 'call_runtime_rebound_task' && run.status === 'completed'
      )));

      expect(runtime.getSubagentRunSummaries()).toEqual([
        expect.objectContaining({
          runId: 'call_runtime_rebound_task',
          label: 'Delegating Agent: Inspect custom runtime rebinding',
          agentName: 'Agent',
          status: 'completed',
          summary: expect.stringContaining('child-tool:child_echo:delegated child hello'),
        }),
      ]);
      expect(customSubagentRunStore.list()).toHaveLength(0);
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
          label: 'Subagent completed',
        }),
      ]));
    } finally {
      unsubscribe();
      await runtime.dispose();
    }
  });

  it('should reject raw Agent tools in Codara runtime options.tools', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-raw-agent-tool-'));
    await expect(createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-raw-agent-tool-session',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [
        createSubagentMiddleware({
          model: new EchoModel() as unknown as BaseChatModel,
        }).tools![0]!,
      ],
    })).rejects.toThrow(
      'Codara runtime does not accept raw Agent tools in options.tools. '
      + 'Register subagent delegation through createSubagentMiddleware() instead.',
    );

    await rm(projectRoot, {recursive: true, force: true});
  });

  it('should not mutate live running task runs when reading summaries', async () => {
    const subagentRunStore = createSubagentRunMemoryStore();
    const runtime = await createRuntimeForTest({
      sessionId: 'runtime-live-task-run-session',
      subagentRunStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    subagentRunStore.start({
      runId: 'run-live',
      parentSessionId: 'runtime-live-task-run-session',
      label: 'Delegating Agent: Inspect live query behavior',
      agentName: 'Agent',
    });

    expect(runtime.getSubagentRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-live',
        status: 'running',
      }),
    ]);
    expect(subagentRunStore.get('run-live')?.status).toBe('running');

    expect(runtime.getSubagentRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-live',
        status: 'running',
      }),
    ]);
    expect(subagentRunStore.get('run-live')?.status).toBe('running');
  });

  it('should surface concurrent delegated approvals, switch approval focus, and keep task approval resume behavior working', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-approval-queue-'));
    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-approval-queue-session',
      model: new MultiDelegatedApprovalModel() as unknown as BaseChatModel,
      skills: false,
      review: {
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
      expect(launched.state.pendingReview).toBeUndefined();

      await waitForCondition(() => runtime.listReviewItems().length === 2);
      const reviews = runtime.listReviewItems();
      expect(reviews).toHaveLength(2);
      expect(reviews.map((review) => review.anchor.subagentRunId).sort()).toEqual(['call_task_alpha', 'call_task_beta']);
      expect(runtime.getAgentState().pendingReview).toBeUndefined();
      await waitForCondition(() => (
        runtimeEvents.filter((event) => (
          event.kind === 'agent'
          && event.phase === 'update'
          && event.status === 'paused'
                && event.label === 'Subagent waiting for review'
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

      const taskRuns = runtime.getSubagentRunSummaries();
      expect(taskRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: alternateReview!.anchor.subagentRunId,
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
        && event.label === 'Subagent completed'
      ))).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('should recover a reopened persisted running task run for the current runtime session', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-agent-run-recovery-'));
    const rootDir = path.join(projectRoot, '.codara', 'agent-runs');

    const originalStore = createSubagentRunFileStore({rootDir});
    originalStore.start({
      runId: 'run-recovery',
      parentSessionId: 'runtime-agent-run-recovery-session',
      label: 'Delegating research: inspect a restart boundary',
      agentName: 'research',
    });

    const reopenedStore = createSubagentRunFileStore({rootDir});
    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-agent-run-recovery-session',
      subagentRunStore: reopenedStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.getSubagentRunSummaries()).toEqual([
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
    const subagentRunStore = createSubagentRunFileStore({
      rootDir: path.join(projectRoot, '.codara', 'agent-runs'),
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

    const customTaskMiddleware = () => createSubagentMiddleware({
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
        createReviewMiddleware({
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
      subagentRunStore,
      approvalStore,
      model: new ReopenableTaskParentModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      middleware: [customTaskMiddleware()],
    });

    try {
      const first = await firstRuntime.invoke('start paused subagent run');
      expect(first.reason).toBe('complete');

      await waitForCondition(() => firstRuntime.listReviewItems().length === 1);
      expect(firstRuntime.getSubagentRunSummaries()).toEqual([
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
      subagentRunStore,
      approvalStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      middleware: [customTaskMiddleware()],
    });

    try {
      const reviews = reopened.listReviewItems();
      expect(reviews).toEqual([
        expect.objectContaining({
          anchor: expect.objectContaining({subagentRunId: 'call_reopen_task'}),
          source: 'subagent_run',
          toolName: 'dangerous_tool',
        }),
      ]);

      await reopened.focusReview(reviews[0]!.reviewId);
      await reopened.resumeReview({decision: 'approve'});
      await waitForCondition(() => reopened.getSubagentRunSummaries().some((run) => (
        run.runId === 'call_reopen_task' && run.status === 'completed'
      )));

      expect(reopened.getSubagentRunSummaries()).toEqual([
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
      pendingReview: {
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
      expect(result.state.pendingReview).toBeUndefined();
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

  it('should keep the prompt stream open through background subagent follow-through and emit the final main reply', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-subagent-followthrough-'));
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
        model: new StreamingSubagentFollowThroughParentModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
        middleware: [
          createSubagentMiddleware({
            model: new StreamingSubagentFollowThroughChildModel() as unknown as BaseChatModel,
            tools: [],
          }),
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of codara.streamInteraction({
        kind: 'prompt',
        input: 'delegate please',
        config: {streamMode: 'messages'},
      })) {
        if (chunk instanceof AIMessageChunk) {
          chunks.push(String(chunk.content));
        }
      }

      expect(chunks).toEqual(['', 'FINAL_FROM_MAIN']);
      expect(String(codara.getAgentState().messages.at(-1)?.content)).toBe('FINAL_FROM_MAIN');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should suppress invalid subagent closeout narration and only emit the retried final main reply', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-subagent-retry-'));
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
        model: new StreamingSubagentRetryingParentModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
        middleware: [
          createSubagentMiddleware({
            model: new StreamingSubagentFollowThroughChildModel() as unknown as BaseChatModel,
            tools: [],
          }),
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of codara.streamInteraction({
        kind: 'prompt',
        input: 'delegate with retry',
        config: {streamMode: 'messages'},
      })) {
        if (chunk instanceof AIMessageChunk) {
          chunks.push(String(chunk.content));
        }
      }

      expect(chunks).toEqual(['', 'FINAL_AFTER_RETRY']);
      expect(String(codara.getAgentState().messages.at(-1)?.content)).toBe('FINAL_AFTER_RETRY');
      expect(codara.getAgentState().messages.map((message) => String(message.content))).not.toContain('Phase 1 has started. Waiting for subagent results.');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should retry orchestration-style subagent closeout chatter until a direct final main reply is produced', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-subagent-orchestration-retry-'));
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
        model: new StreamingSubagentOrchestrationRetryingParentModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
        middleware: [
          createSubagentMiddleware({
            model: new StreamingSubagentFollowThroughChildModel() as unknown as BaseChatModel,
            tools: [],
          }),
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of codara.streamInteraction({
        kind: 'prompt',
        input: 'delegate orchestration retry',
        config: {streamMode: 'messages'},
      })) {
        if (chunk instanceof AIMessageChunk) {
          chunks.push(String(chunk.content));
        }
      }

      expect(chunks).toEqual(['', 'FINAL_AFTER_ORCHESTRATION_RETRY']);
      expect(String(codara.getAgentState().messages.at(-1)?.content)).toBe('FINAL_AFTER_ORCHESTRATION_RETRY');
      expect(codara.getAgentState().messages.map((message) => String(message.content))).not.toContain('两个 subagent 都已完成！现在让我汇总它们的发现，提炼出当前架构最核心的边界：');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should suppress raw child-style subagent replay and keep it out of parent-visible messages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-subagent-raw-replay-retry-'));
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
        model: new StreamingSubagentRawReplayRetryingParentModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
        middleware: [
          createSubagentMiddleware({
            model: new StreamingSubagentVerboseChildModel() as unknown as BaseChatModel,
            tools: [],
          }),
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of codara.streamInteraction({
        kind: 'prompt',
        input: 'delegate raw replay',
        config: {streamMode: 'messages'},
      })) {
        if (chunk instanceof AIMessageChunk) {
          chunks.push(String(chunk.content));
        }
      }

      expect(chunks).toEqual(['', 'FINAL_AFTER_RAW_REPLAY_RETRY']);
      expect(String(codara.getAgentState().messages.at(-1)?.content)).toBe('FINAL_AFTER_RAW_REPLAY_RETRY');
      expect(codara.getAgentState().messages.map((message) => String(message.content)).join('\n')).not.toContain(RAW_CHILD_REPORT);
      expect(codara.getAgentState().messages.map((message) => String(message.content)).join('\n')).not.toContain('src/cli 目录架构分析报告');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
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
      expect(paused.state.pendingReview?.action.toolName).toBe('AskUserQuestion');
      expect(paused.state.pendingReview?.ui?.form?.tabs[0]?.label).toBe('Domain');

      await codara.resumeReview({
        action: 'submit',
        metadata: {
          form: {
            answers: {
              domain: 'SaaS',
            },
          },
        },
      });
      const resumedState = await codara.hydrate();
      expect(String(resumedState.messages[resumedState.messages.length - 1]?.content)).toBe('ASK_USER_DONE');
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
