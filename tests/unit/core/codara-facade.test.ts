import {describe, expect, it} from 'bun:test';
import {createAgentFileCheckpointer, createAgentMemoryCheckpointer, createCodara, createCodaraRuntime} from '@/index';
import {assembleCodara} from '@/codara/facade';
import {TeamRegistry} from '@capability/team/coordination/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {MemberSession} from '@capability/team/runtime/member-runner';
import {TeamPersistence} from '@capability/team/persistence';
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
import {createTaskRunFileStore, createTaskRunMemoryStore, createTaskRuntime, TASK_TOOL_NAME} from '@/capability/task';
import {createTaskTool} from '@/capability/task/middleware';

const createRuntimeForTest = (options: Parameters<typeof createCodaraRuntime>[0]) => (
  createCodaraRuntime({
    ...options,
    autoMemory: false,
    teams: options?.teams ?? true,
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

    if (text.includes('Inspect isolated child work') && !text.includes('Delegated task started in background.')) {
      return new AIMessage('CHILD_FLOW_DONE');
    }

    if (text.includes('Delegated task started in background.')) {
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
          name: 'Task',
          args: {
            prompt: 'Inspect alpha approval path',
            subagent_type: 'general-purpose',
          },
        } as ToolCall,
        {
          id: 'call_task_beta',
          name: 'Task',
          args: {
            prompt: 'Inspect beta approval path',
            subagent_type: 'general-purpose',
          },
        } as ToolCall,
      ],
    });
  }

  bindTools(): this {
    return this;
  }
}

function createTeamApprovalSession(behavior?: {
  beforeInvoke?: () => Promise<void> | void;
  beforeResume?: () => Promise<void> | void;
  invokeResult?: () => {reason: 'complete' | 'continue' | 'error' | 'idle' | 'paused'; pause?: import('@core/agent').PauseRequest};
  resumeResult?: () => {reason: 'complete' | 'continue' | 'error' | 'idle' | 'paused'; pause?: import('@core/agent').PauseRequest};
}): MemberSession {
  let pendingPause: import('@core/agent').PauseRequest | undefined;
  return {
    invoke: async () => {
      await behavior?.beforeInvoke?.();
      const result = behavior?.invokeResult?.() ?? {reason: 'complete' as const};
      pendingPause = result.reason === 'paused' ? result.pause : undefined;
      return result;
    },
    resumePause: async () => {
      await behavior?.beforeResume?.();
      const result = behavior?.resumeResult?.() ?? {reason: 'complete' as const};
      pendingPause = result.reason === 'paused' ? result.pause : undefined;
      return result;
    },
    getPendingPause: () => pendingPause,
    dispose: async () => {},
  };
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
    const taskRunStore = createTaskRunFileStore({
      rootDir: path.join(projectRoot, '.codara', 'task-runs'),
    });

    taskRunStore.start({
      runId: 'run-session-a',
      sessionId: 'runtime-task-run-session-a',
      label: 'Delegating general-purpose: Inspect isolated child work',
      agentName: 'general-purpose',
    });
    taskRunStore.finish('run-session-a', {
      type: 'delegated_agent_result',
      sessionId: 'child-a',
      turns: 1,
      reason: 'complete',
      summary: 'done a',
    });

    taskRunStore.start({
      runId: 'run-session-b',
      sessionId: 'runtime-task-run-session-b',
      label: 'Delegating general-purpose: Inspect another child work',
      agentName: 'general-purpose',
    });
    taskRunStore.finish('run-session-b', {
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
      taskRunStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.getTaskRunSummaries()).toEqual([
      expect.objectContaining({
        label: 'Delegating general-purpose: Inspect isolated child work',
        agentName: 'general-purpose',
        status: 'completed',
      }),
    ]);
    expect(runtime.getTaskRunSummaries()).toHaveLength(1);
  });

  it('should rebind a caller-provided Task tool to the runtime stores while preserving child tools', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-custom-task-'));
    const runtimeTaskRunStore = createTaskRunMemoryStore();
    const runtimeApprovalStore = createApprovalMemoryStore();
    const customTaskRunStore = createTaskRunMemoryStore();
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
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Inspect custom runtime rebinding',
              subagent_type: 'general-purpose',
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
      taskRunStore: runtimeTaskRunStore,
      approvalStore: runtimeApprovalStore,
      model: new RuntimeReboundTaskParentModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [
        createTaskTool({
          model: new RuntimeReboundTaskChildModel() as unknown as BaseChatModel,
          tools: [
            tool(async ({value}: {value: string}) => `child_echo:${value}`, {
              name: 'child_echo',
              description: 'Child tool preserved through Task tool rebinding.',
              schema: z.object({
                value: z.string(),
              }),
            }),
          ],
          runStore: customTaskRunStore,
          approvalStore: customApprovalStore,
          runtime: createTaskRuntime({
            runStore: customTaskRunStore,
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

      await waitForCondition(() => runtime.getTaskRunSummaries().some((run) => (
        run.runId === 'call_runtime_rebound_task' && run.status === 'completed'
      )));

      expect(runtime.getTaskRunSummaries()).toEqual([
        expect.objectContaining({
          runId: 'call_runtime_rebound_task',
          label: 'Delegating general-purpose: Inspect custom runtime rebinding',
          agentName: 'general-purpose',
          status: 'completed',
          summary: expect.stringContaining('child-tool:child_echo:delegated child hello'),
        }),
      ]);
      expect(customTaskRunStore.list()).toHaveLength(0);
      expect(runtimeEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating general-purpose: Inspect custom runtime rebinding',
        }),
        expect.objectContaining({
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Delegated task running in background',
        }),
      ]));
    } finally {
      unsubscribe();
      await runtime.dispose();
    }
  });

  it('should not mutate live running task runs when reading summaries', async () => {
    const taskRunStore = createTaskRunMemoryStore();
    const runtime = await createRuntimeForTest({
      sessionId: 'runtime-live-task-run-session',
      taskRunStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    taskRunStore.start({
      runId: 'run-live',
      sessionId: 'runtime-live-task-run-session',
      label: 'Delegating general-purpose: Inspect live query behavior',
      agentName: 'general-purpose',
    });

    expect(runtime.getTaskRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-live',
        status: 'running',
      }),
    ]);
    expect(taskRunStore.get('run-live')?.status).toBe('running');

    expect(runtime.getTaskRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-live',
        status: 'running',
      }),
    ]);
    expect(taskRunStore.get('run-live')?.status).toBe('running');
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

      await waitForCondition(() => runtime.getApprovalSummaries().length === 2);
      const approvals = runtime.getApprovalSummaries();
      expect(approvals).toHaveLength(2);
      expect(approvals.map((approval) => approval.taskRunId).sort()).toEqual(['call_task_alpha', 'call_task_beta']);
      expect(runtime.getAgentState().pendingPause).toBeUndefined();
      await waitForCondition(() => (
        runtimeEvents.filter((event) => (
          event.kind === 'task'
          && event.phase === 'update'
          && event.status === 'paused'
          && event.label === 'Delegated task waiting for review'
        )).length >= 2
      ));

      const alternateApproval = approvals[1];
      expect(alternateApproval).toBeDefined();

      await runtime.focusApproval(alternateApproval!.approvalId);
      expect(runtime.getFocusedApprovalReview()?.summary.approvalId).toBe(alternateApproval!.approvalId);
      expect(runtime.getApprovalSummaries().find((approval) => approval.approvalId === alternateApproval!.approvalId)?.isForeground).toBe(true);

      await runtime.resumeApproval({action: 'allow_once'});
      await waitForCondition(() => runtime.getApprovalSummaries().length === 1);

      const remainingApprovals = runtime.getApprovalSummaries();
      expect(remainingApprovals).toHaveLength(1);
      expect(remainingApprovals[0]?.approvalId).not.toBe(alternateApproval!.approvalId);
      expect(runtime.getFocusedApprovalReview()?.summary.approvalId).toBe(remainingApprovals[0]?.approvalId);

      const taskRuns = runtime.getTaskRunSummaries();
      expect(taskRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: alternateApproval!.taskRunId,
          status: 'completed',
        }),
        expect.objectContaining({
          status: 'paused',
        }),
      ]));
      expect(runtimeEvents.some((event) => (
        event.kind === 'task'
        && event.phase === 'end'
        && event.status === 'done'
        && event.label === 'Delegated task completed'
      ))).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('should resume a queued team-member approval through the Codara facade and clear the queue entry', async () => {
    const approvalStore = createApprovalMemoryStore();
    const registry = new TeamRegistry();
    const pauseRequest: import('@core/agent').PauseRequest = {
      id: 'pause-team-facade-worker',
      description: 'Worker approval required',
      action: {
        toolCallId: 'call_worker_approval',
        toolName: 'dangerous_tool',
        toolArgs: {target: 'tmp/out.txt'},
      },
      review: {
        actionName: 'dangerous_tool',
        allowedDecisions: ['approve', 'reject'],
      },
      runtime: {
        runId: 'run-worker-approval',
        turn: 1,
        requestId: 'req-worker-approval',
        toolIndex: 0,
      },
    };

    let firstInvoke = true;
    let teamId = '';
    let workerId = '';
    const teamRuntime = new TeamRuntime({
      registry,
      projectRoot: '/tmp/test',
      approvalStore,
      sessionId: 'team-facade-approval-session',
      createSession: () => createTeamApprovalSession({
        beforeInvoke: async () => {
          if (teamId && workerId) {
            await teamRuntime.getTransport(teamId)?.receive(workerId);
          }
        },
        invokeResult: () => {
          if (firstInvoke) {
            firstInvoke = false;
            return {reason: 'paused', pause: pauseRequest};
          }
          return {reason: 'complete'};
        },
        resumeResult: () => ({reason: 'complete'}),
      }),
    });

    const codara = assembleCodara({
      sessionId: 'team-facade-approval-session',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      autoMemory: false,
      hil: false,
    }, undefined, {
      teamRegistry: registry,
      teamRuntime,
      approvalStore,
    });

    try {
      const team = registry.createTeam({
        name: 'facade-team',
        goal: 'verify approval resume',
        config: {
          maxDepth: 2,
          allowSubTeams: true,
          maxMembers: 10,
          modelCascade: {},
          autoShutdown: true,
        },
      });
      teamId = team.teamId;

      await teamRuntime.startTeam(team.teamId);
      const worker = await teamRuntime.spawnMember(team.teamId, 'approval-worker', 'worker');
      workerId = worker.memberId;

      await teamRuntime.getTransport(team.teamId)!.send(worker.memberId, {
        id: 'msg-approval-1',
        from: 'leader',
        to: worker.memberId,
        teamId: team.teamId,
        type: 'message',
        content: 'perform the risky step',
        timestamp: new Date().toISOString(),
        read: false,
      });

      teamRuntime.getRunner(worker.memberId)?.wake();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(codara.getApprovalSummaries()).toEqual([
        expect.objectContaining({
          source: 'team_member',
          teamId: team.teamId,
          memberId: worker.memberId,
          description: 'Worker approval required',
          isForeground: true,
        }),
      ]);
      expect(codara.getFocusedApprovalReview()?.summary.approvalId).toBe('pause-team-facade-worker');
      expect(registry.getTeam(team.teamId)?.status).toBe('paused');

      await codara.resumeApproval({action: 'allow_once'});
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(codara.getApprovalSummaries()).toHaveLength(0);
      expect(codara.getFocusedApprovalReview()).toBeUndefined();
      expect(registry.getTeam(team.teamId)?.status).toBe('running');
    } finally {
      await codara.dispose();
    }
  });

  it('should recover a reopened persisted running task run for the current runtime session', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-task-run-recovery-'));
    const rootDir = path.join(projectRoot, '.codara', 'task-runs');

    const originalStore = createTaskRunFileStore({rootDir});
    originalStore.start({
      runId: 'run-recovery',
      sessionId: 'runtime-task-run-recovery-session',
      label: 'Delegating research: inspect a restart boundary',
      agentName: 'research',
    });

    const reopenedStore = createTaskRunFileStore({rootDir});
    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId: 'runtime-task-run-recovery-session',
      taskRunStore: reopenedStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.getTaskRunSummaries()).toEqual([
      expect.objectContaining({
        runId: 'run-recovery',
        status: 'paused',
      }),
    ]);
    expect(reopenedStore.get('run-recovery')).toEqual(expect.objectContaining({
      status: 'paused',
    }));
  });

  it('should scope team summaries and detail to the current session runtime teams', async () => {
    const registry = new TeamRegistry();
    const ownTeam = registry.createTeam({
      name: 'own-team',
      goal: 'Visible in this session',
      createdBy: 'session-own',
    });
    const foreignTeam = registry.createTeam({
      name: 'foreign-team',
      goal: 'Hidden from this session',
      createdBy: 'session-other',
    });
    registry.updateTeamStatus(ownTeam.teamId, 'running');
    registry.updateTeamStatus(foreignTeam.teamId, 'running');

    const codara = assembleCodara({
      sessionId: 'session-own',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      autoMemory: false,
      hil: false,
    }, undefined, {
      teamRegistry: registry,
    });

    try {
      expect(codara.getTeamSummaries()).toEqual([
        expect.objectContaining({
          teamId: ownTeam.teamId,
          name: 'own-team',
          status: 'running',
        }),
      ]);
      expect(codara.getTeamDetail(ownTeam.teamId)).toEqual(expect.objectContaining({
        teamId: ownTeam.teamId,
        name: 'own-team',
      }));
      expect(codara.getTeamDetail(foreignTeam.teamId)).toBeUndefined();
    } finally {
      await codara.dispose();
    }
  });

  it('should restore persisted team recent messages into reopened runtime logs', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-team-logs-reopen-'));
    const runtimeStatePath = path.join(projectRoot, '.codara');
    const sessionId = 'runtime-team-logs-reopen-session';
    const persistence = new TeamPersistence(runtimeStatePath);
    const registry = new TeamRegistry();
    const team = registry.createTeam({
      name: 'restored-team',
      goal: 'Review restored logs',
      createdBy: sessionId,
    });
    registry.updateTeamStatus(team.teamId, 'running');
    registry.updateTeamStatus(team.teamId, 'paused');

    persistence.save(team.teamId, TeamPersistence.buildSnapshot(
      registry.getTeam(team.teamId)!,
      [],
      registry.getJobBoard(team.teamId),
      [{
        id: 'msg-restored-1',
        from: 'worker-1',
        to: 'leader',
        teamId: team.teamId,
        type: 'message',
        content: 'restored handoff payload',
        timestamp: new Date().toISOString(),
        read: false,
      }],
    ));

    const runtime = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      sessionId,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
    });

    try {
      expect(runtime.getTeamSummaries()).toEqual([
        expect.objectContaining({
          name: 'restored-team',
          status: 'paused',
        }),
      ]);

      const logs = await runtime.executeCommand('/team logs restored-team 5');
      expect(logs.ok).toBe(true);
      expect(logs.output).toContain('restored handoff payload');
    } finally {
      await runtime.dispose();
      await rm(projectRoot, {recursive: true, force: true});
    }
  });

  it('should keep the team command unavailable when teams are disabled', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-teams-disabled-'));

    try {
      const runtime = await createCodaraRuntime({
        cwd: projectRoot,
        projectRoot,
        autoMemory: false,
        teams: false,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
      });

      const result = await runtime.executeCommand('/team list');

      expect(result.ok).toBe(false);
      expect(result.output).toContain('Team system not initialized');
      expect(runtime.getTeamSummaries()).toEqual([]);

      await runtime.dispose();
    } finally {
      await rm(projectRoot, {recursive: true, force: true});
    }
  });

  it('should enable teams from project settings when teams.enabled=true', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-teams-enabled-'));

    try {
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
        teams: {
          enabled: true,
        },
      }, null, 2));

      const runtime = await createCodaraRuntime({
        cwd: projectRoot,
        projectRoot,
        autoMemory: false,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
      });

      const result = await runtime.executeCommand('/team list');

      expect(result.ok).toBe(true);
      expect(result.output).toContain('No active teams.');

      await runtime.dispose();
    } finally {
      await rm(projectRoot, {recursive: true, force: true});
    }
  });

  it('should resume a reopened persisted task approval through the task runtime control plane', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-runtime-paused-task-reopen-'));
    const taskRunStore = createTaskRunFileStore({
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
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Inspect the guarded child flow',
              subagent_type: 'general-purpose',
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

    const customTaskTool = () => createTaskTool({
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
      middleware: [
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
      taskRunStore,
      approvalStore,
      model: new ReopenableTaskParentModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [customTaskTool()],
    });

    try {
      const first = await firstRuntime.invoke('start paused delegated task');
      expect(first.reason).toBe('complete');

      await waitForCondition(() => firstRuntime.getApprovalSummaries().length === 1);
      expect(firstRuntime.getTaskRunSummaries()).toEqual([
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
      taskRunStore,
      approvalStore,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      tools: [customTaskTool()],
    });

    try {
      const approvals = reopened.getApprovalSummaries();
      expect(approvals).toEqual([
        expect.objectContaining({
          taskRunId: 'call_reopen_task',
          source: 'task_run',
          toolName: 'dangerous_tool',
        }),
      ]);

      await reopened.focusApproval(approvals[0]!.approvalId);
      await reopened.resumeApproval({decision: 'approve'});
      await waitForCondition(() => reopened.getTaskRunSummaries().some((run) => (
        run.runId === 'call_reopen_task' && run.status === 'completed'
      )));

      expect(reopened.getTaskRunSummaries()).toEqual([
        expect.objectContaining({
          runId: 'call_reopen_task',
          status: 'completed',
          summary: expect.stringContaining('recovered_child_done:danger:reopen-guarded.txt'),
        }),
      ]);
      expect(reopened.getApprovalSummaries()).toEqual([]);
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
