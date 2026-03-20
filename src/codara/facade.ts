import {existsSync} from 'node:fs';
import path from 'node:path';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentResumeStreamConfig, AgentStreamOutput, ResumePayload} from '@core/agent';
import {createAgentFileCheckpointer} from '@durability/checkpoint';
import {createApprovalFileStore, type ApprovalStore} from '@durability/approval-store';
import {ensurePermissionSettingsFile} from '@core/middleware/permission';
import {createTaskRunFileStore, createTaskRuntime, type TaskRunStore, type TaskRuntime} from '@capability/task';
import {createTaskFileStore} from '@capability/task/store';
import {loadModelRoutingConfigFromPath, resolveCodaraPath} from '@integration/provider';
import {createCodaraGuidelinesSource, type GuidelinesSource} from '@context/instructions/guidelines';
import {createCodaraPromptSource, type PromptSource} from '@context/prompts/prompt-source';
import {buildBaseSystemMessage} from '@context/session-bundle/base-system-message';
import {createCodaraSkillsSource} from '@capability/skill';
import {createSkillCodaraCommands} from '@capability/command/runtime/skill-commands';
import {createCodaraCommandRunner, type CodaraCommandResult} from '@capability/command';
import {
  createSession, FileSessionStore,
  type SessionState, type SessionStore,
} from '@durability/session';
import type {CodaraRuntimeEvent, CodaraRuntimeEventListener} from '@observability/events';
import {resolveWorkspaceRoot} from '@config/workspace';
import {resolveTeamsEnabled} from '@config/settings';
import {HookRegistryImpl, HookPipeline, createHookExecutor} from '@observability/hook';
import type {HookSource, HookRegistry, SessionLifecycleHooks, AgentLifecycleHooks} from '@observability/hook';
import {loadMcpConfig, createMcpManager, createMcpLangChainTools, type McpManager} from '@integration/mcp';
import type {ChannelRegistry} from '@integration/channel';
import type {TeamRegistry} from '@capability/team/coordination/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {TeamSurfaceState} from '@capability/team/middleware';
import {
  createCodaraMiddlewares,
  createRuntimeDefaultMiddlewares,
  resolveRuntimeLoggingOptions,
} from './assembly/middleware';
import {getApprovalSummaries} from './assembly/approvals';
import {assembleTeamSystem, getTeamSummaries, getTeamDetail} from './assembly/collaboration';
import {getTaskRunSummaries} from './assembly/task-runs';
import {
  createCodaraModelCatalog,
  DEFAULT_CODARA_MODEL_ALIAS,
} from './assembly/runtime';
import {createCodaraTools} from './assembly/tools';
import {resolveCodaraAutoMemory, resolveCodaraSkills} from './assembly/context';
import type {
  ApprovalQueryReview,
  Codara, CodaraOptions, CodaraRuntimeOptions,
} from './types';

// Re-export all types from types.ts for backward compatibility
export type {
  Codara, CodaraOptions, CodaraRuntimeOptions, CodaraAutoMemoryOptions,
  CodaraSkillOptions, CodaraMiddlewareOptions,
  CreateCodaraModelCatalogOptions, CreateCodaraChatModelOptions,
  ApprovalQuerySummary,
  ApprovalQueryReview,
  TaskRunQuerySummary,
  TeamQuerySummary, TeamQueryMember, TeamQueryJob, TeamQueryDetail,
} from './types';

export {createCodaraMiddlewares} from './assembly/middleware';
export {createCodaraTools, type CodaraToolsOptions} from './assembly/tools';
export {
  CodaraModelCatalog,
  createCodaraChatModel,
  createCodaraModelCatalog,
  DEFAULT_CODARA_MODEL_ALIAS,
} from './assembly/runtime';

// ── Public Entry Points ──

export function createCodara(options: CodaraOptions = {}): Codara {
  return assembleCodara(options);
}

export async function createCodaraRuntime(options: CodaraRuntimeOptions = {}): Promise<Codara> {
  const projectRoot = resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});
  const codaraPath = resolveCodaraRuntimePath(options);
  const runtimeStatePath = path.join(projectRoot, '.codara');

  // 1. Infrastructure
  const guidelinesSource = createCodaraGuidelinesSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const promptSource = createCodaraPromptSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;
  const autoMemory = resolveCodaraAutoMemory(options);
  const baseSystemMessage = await buildBaseSystemMessage({
    promptSource,
    guidelinesSource,
    skillsSource,
    autoMemorySource: autoMemory?.source,
    memoryRootDir: autoMemory?.rootDir,
  });
  const taskStore = options.taskStore ?? createTaskFileStore({
    rootDir: path.join(runtimeStatePath, 'tasks'),
  });
  const taskRunStore = options.taskRunStore ?? createTaskRunFileStore({
    rootDir: path.join(runtimeStatePath, 'task-runs'),
  });
  const approvalStore = options.approvalStore ?? createApprovalFileStore({
    rootDir: path.join(runtimeStatePath, 'approvals'),
  });
  const runtimeCheckpointer = options.checkpointer ?? createAgentFileCheckpointer({
    rootDir: path.join(runtimeStatePath, 'sessions'),
  });
  const taskRuntime = createTaskRuntime({runStore: taskRunStore, approvalStore});
  ensurePermissionSettingsFile({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });

  // 2. Model catalog
  const catalog = !options.model && !options.catalog && !options.config
    ? loadModelRoutingConfigFromPath(codaraPath).then((config) => createCodaraModelCatalog({config}))
    : options.catalog;

  // 3. Logging + tools
  const logging = resolveRuntimeLoggingOptions(options);
  const runtimeTools: StructuredToolInterface[] = createCodaraTools({
    builtinTools: options.builtinTools, cwd: options.cwd, tools: options.tools,
  });

  // 4. Hooks
  const hookSources: HookSource[] = [{kind: 'project', path: path.join(runtimeStatePath, 'hooks.json')}];
  const userHome = options.userHome ?? process.env.HOME ?? '';
  if (userHome) hookSources.push({kind: 'user', path: path.join(userHome, '.codara', 'hooks.json')});
  const hookRegistry = new HookRegistryImpl();
  await hookRegistry.load(hookSources);
  const hookPipeline = new HookPipeline(hookRegistry, {
    createStrategy: (hook) => createHookExecutor(hook, {projectRoot: codaraPath}),
  });

  // 5. MCP
  let mcpManager: McpManager | undefined;
  if (options.mcp !== false) {
    const mcpConfig = options.mcp ?? await loadMcpConfig({projectRoot, userHome: options.userHome});
    if (Object.keys(mcpConfig.mcpServers).length > 0) {
      mcpManager = createMcpManager(mcpConfig);
      await mcpManager.init();
      runtimeTools.push(...createMcpLangChainTools(mcpManager));
    }
  }

  // 6. Team system
  const teamsEnabled = typeof options.teams === 'boolean'
    ? options.teams
    : resolveTeamsEnabled({
        cwd: options.cwd,
        projectRoot: options.projectRoot,
        userHome: options.userHome,
      });
  const teamSystem = teamsEnabled
    ? await assembleTeamSystem({options, runtimeStatePath, projectRoot, catalog, approvalStore, baseSystemMessage})
    : undefined;
  const initialRuntimeContext = deriveInitialRuntimeContext(options.context, teamSystem?.restoredActiveTeamId);

  // 7. Middleware chain
  const runtimeMiddlewares = createRuntimeDefaultMiddlewares({
    options, runtimeTools, taskStore, taskRunStore, taskRuntime, taskCheckpointer: runtimeCheckpointer, approvalStore, logging, catalog, promptSource, guidelinesSource, hookPipeline,
    teamRegistry: teamSystem?.teamRegistry, teamRuntime: teamSystem?.teamRuntime, teamSharedState: teamSystem?.sharedState,
    channelRegistry: options.channelRegistry,
  });

  // 8. Assemble facade
  const runtime = assembleCodara({
    ...options,
    tools: runtimeTools, middleware: runtimeMiddlewares, hil: false,
    autoMemory: options.autoMemory === false ? false
      : (typeof options.autoMemory === 'object' && options.autoMemory !== null ? options.autoMemory : {}),
    summary: options.summary === false ? false : (options.summary ?? {}),
    ...(logging === false ? {logging: false} : {logging}),
    ...(catalog ? {catalog} : {}),
    ...(initialRuntimeContext ? {context: initialRuntimeContext} : {}),
    ...(options.store ? {} : {store: new FileSessionStore({basePath: path.join(runtimeStatePath, 'sessions')})}),
    ...(options.checkpointer ? {} : {
      checkpointer: runtimeCheckpointer,
    }),
    restore: options.restore ?? 'latest',
  }, undefined, {
    promptSource, guidelinesSource, hookPipeline, hookRegistry, mcpManager,
    teamRegistry: teamSystem?.teamRegistry, teamRuntime: teamSystem?.teamRuntime,
    taskRunStore, taskRuntime, approvalStore,
    channelRegistry: options.channelRegistry,
  });

  if (teamSystem && !hasPreconfiguredTeamSurface(options.context)) {
    const resumableTeams = getTeamSummaries(teamSystem.teamRegistry)
      .filter((team) => team.status === 'running' || team.status === 'paused');
    if (resumableTeams.length === 1) {
      const [team] = resumableTeams;
      await runtime.updateContext({
        teamSurface: {
          activeTeamId: team!.teamId,
          teamRole: 'leader',
          teamMode: 'leader',
        },
      });
    }
  }

  return runtime;
}

function hasPreconfiguredTeamSurface(context: CodaraOptions['context']): boolean {
  if (!context || typeof context !== 'object') {
    return false;
  }

  const teamSurface = (context as Record<string, unknown>).teamSurface;
  return Boolean(teamSurface && typeof teamSurface === 'object');
}

function deriveInitialRuntimeContext(
  context: CodaraRuntimeOptions['context'],
  restoredActiveTeamId: string | undefined,
) {
  if (!restoredActiveTeamId) {
    return context;
  }

  const existingSurface = context?.teamSurface as TeamSurfaceState | undefined;
  if (existingSurface?.activeTeamId) {
    return context;
  }

  return {
    ...(context ?? {}),
    teamSurface: {
      activeTeamId: restoredActiveTeamId,
      teamRole: 'leader',
      teamMode: 'leader',
    } satisfies TeamSurfaceState,
  };
}

// ── Session Openers ──

export async function openCodaraSession(
  options: CodaraOptions & {sessionId: string; store: SessionStore},
): Promise<Codara> {
  const sessionState = await options.store.get(options.sessionId);
  if (!sessionState) throw new Error(`Session not found: ${options.sessionId}`);
  return reopenCodaraSession(options, sessionState);
}

export async function openLatestCodaraSession(
  options: CodaraOptions & {store: SessionStore},
): Promise<Codara> {
  const sessions = await options.store.list({
    includeArchived: true, sortBy: 'updatedAt', sortOrder: 'desc',
  });
  const latest = sessions.find((s) => s.sessionStatus !== 'closed') ?? sessions[0];
  if (!latest) throw new Error('No sessions found');
  return reopenCodaraSession(options, latest);
}

// ── Core Assembly ──

export function assembleCodara(
  options: CodaraOptions,
  restoredState?: SessionState,
  preloadedSources?: {
    promptSource?: PromptSource; guidelinesSource?: GuidelinesSource;
    hookPipeline?: HookPipeline; hookRegistry?: HookRegistry;
    mcpManager?: McpManager; teamRegistry?: TeamRegistry; teamRuntime?: TeamRuntime;
    taskRunStore?: TaskRunStore;
    taskRuntime?: TaskRuntime;
    approvalStore?: ApprovalStore;
    channelRegistry?: ChannelRegistry;
  },
): Codara {
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;
  const autoMemory = resolveCodaraAutoMemory(options);
  const alias = normalizeAlias(options.alias);
  const guidelinesSource = preloadedSources?.guidelinesSource ?? createCodaraGuidelinesSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const promptSource = preloadedSources?.promptSource ?? createCodaraPromptSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });

  const tools = createCodaraTools(options);
  const session = createSession({
    ...(restoredState ? {state: restoredState} : {}),
    id: options.id, sessionId: options.sessionId, store: options.store,
    checkpointer: options.checkpointer, restore: options.restore,
    messages: options.messages, context: options.context, values: options.values,
    modelRef: alias,
    ...(options.model ? {model: options.model} : {}),
    ...(!options.model ? {modelCatalog: options.catalog ?? createCodaraModelCatalog({config: options.config})} : {}),
    guidelinesSource, promptSource,
    ...(skillsSource ? {skillsSource} : {}),
    ...(autoMemory ? {autoMemory} : {}),
    tools,
    ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
    middleware: createCodaraMiddlewares(options, preloadedSources?.channelRegistry),
    ...(options.summary ? {summary: options.summary} : {}),
    ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
    ...(preloadedSources?.hookPipeline ? {lifecycle: preloadedSources.hookPipeline as SessionLifecycleHooks & AgentLifecycleHooks} : {}),
  });
  preloadedSources?.taskRunStore?.recoverSession?.(session.getState().sessionId);

  // Extra properties for commands (/reload, /hooks, /mcp)
  const mcpManager = preloadedSources?.mcpManager;
  const extraProps: Record<string, PropertyDescriptor> = {};
  if (preloadedSources?.hookRegistry) extraProps.hookRegistry = {value: preloadedSources.hookRegistry, writable: false};
  if (mcpManager) extraProps.getMcpStatus = {value: () => mcpManager.status(), writable: false};
  if (preloadedSources?.teamRegistry) extraProps.teamRegistry = {value: preloadedSources.teamRegistry, writable: false};
  if (preloadedSources?.teamRuntime) extraProps.teamRuntime = {value: preloadedSources.teamRuntime, writable: false};
  const commandAgent = Object.keys(extraProps).length > 0 ? Object.create(session, extraProps) : session;

  const commands = createCodaraCommandRunner({
    agent: commandAgent,
    environment: {cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome, modelAlias: alias},
    ...(skillsSource ? {getDynamicCommands: () => createSkillCodaraCommands(skillsSource)} : {}),
  });

  // Command event relay
  const commandEventListeners = new Set<CodaraRuntimeEventListener>();
  const subscribeRuntimeEvents = (listener: CodaraRuntimeEventListener) => {
    const unsubscribeSession = session.subscribeRuntimeEvents(listener);
    commandEventListeners.add(listener);
    return () => { unsubscribeSession(); commandEventListeners.delete(listener); };
  };
  const emitCommandEvent = (input: Omit<CodaraRuntimeEvent, 'sessionId' | 'timestamp'>) => {
    const event: CodaraRuntimeEvent = {
      ...input, sessionId: session.getState().sessionId, timestamp: new Date().toISOString(),
    };
    for (const listener of commandEventListeners) listener(event);
  };
  const executeCommand = async (input: string): Promise<CodaraCommandResult> => {
    const id = `command:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    emitCommandEvent({id, kind: 'command', phase: 'start', status: 'running', label: `Running ${input.trim()}`});
    const result = await commands.executeCommand(input);
    emitCommandEvent({
      id: `command:end:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind: 'command', phase: 'end', status: result.ok ? 'done' : 'error',
      label: result.ok ? `Completed ${input.trim()}` : `Failed ${input.trim()}`,
      detail: result.output.trim() || undefined, parentId: id,
    });
    return result;
  };

  // Wire team events into runtime event stream
  if (preloadedSources?.teamRuntime) {
    preloadedSources.teamRuntime.setOnTeamEvent(
      (event) => { for (const listener of commandEventListeners) listener(event); },
      () => session.getState().sessionId,
    );
  }
  if (preloadedSources?.taskRuntime) {
    preloadedSources.taskRuntime.setOnTaskEvent(
      (event) => { for (const listener of commandEventListeners) listener(event); },
      () => session.getState().sessionId,
    );
  }

  const channelRegistry = preloadedSources?.channelRegistry;

  const teamRuntime = preloadedSources?.teamRuntime;
  const taskRuntime = preloadedSources?.taskRuntime;
  const teamRegistry = preloadedSources?.teamRegistry;
  const approvalStore = preloadedSources?.approvalStore;
  let focusedApprovalId: string | undefined;
  const readForegroundApprovalId = (): string | undefined => {
    try {
      return session.getAgentState().pendingPause?.id;
    } catch {
      return undefined;
    }
  };

  const dispose = async (): Promise<void> => {
    // Shut down all running teams before disposing session
    if (teamRuntime && teamRegistry) {
      const activeTeams = teamRegistry.listTeams().filter(
        (t) => t.status === 'running' || t.status === 'paused',
      );
      for (const team of activeTeams) {
        try {
          await teamRuntime.shutdownTeam(team.teamId);
        } catch {
          // Best-effort — continue disposing other resources
        }
      }
    }
    await taskRuntime?.dispose();
    await session.dispose();
    if (mcpManager) await mcpManager.dispose();
    if (channelRegistry) await channelRegistry.disposeAll();
  };

  const listCurrentApprovalRecords = () => approvalStore?.list(session.getState().sessionId) ?? [];

  const resolveFocusedApprovalRecord = () => {
    const approvals = listCurrentApprovalRecords();
    if (approvals.length === 0) {
      focusedApprovalId = undefined;
      return undefined;
    }

    const focused = focusedApprovalId
      ? approvals.find((record) => record.approvalId === focusedApprovalId)
      : undefined;
    if (focused) {
      return focused;
    }

    focusedApprovalId = approvals[0]!.approvalId;
    return approvals[0]!;
  };

  const getFocusedApprovalReview = (): ApprovalQueryReview | undefined => {
    const record = resolveFocusedApprovalRecord();
    if (!record) {
      return undefined;
    }

    const summary = getApprovalSummaries(
      approvalStore,
      session.getState().sessionId,
      record.approvalId,
    ).find((approval) => approval.approvalId === record.approvalId);
    if (!summary) {
      return undefined;
    }

    return {
      summary,
      request: record.pauseRequest,
    };
  };

  const resumeApprovalStream = async function* (
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void> {
    const record = resolveFocusedApprovalRecord();
    if (!record) {
      throw new Error('No queued approval is available for the current session');
    }

    switch (record.source) {
      case 'task_run': {
        if (!taskRuntime) {
          throw new Error('Task approval runtime is not available');
        }
        yield* taskRuntime.resumeApprovalByIdStream(record.approvalId, payload, config);
        break;
      }
      case 'team_member': {
        if (!teamRuntime) {
          throw new Error('Team approval runtime is not available');
        }
        yield* teamRuntime.resumeApprovalByIdStream(record.approvalId, payload) as AsyncGenerator<AgentStreamOutput, void, void>;
        break;
      }
    }

    resolveFocusedApprovalRecord();
  };

  const resumeApproval = async (payload: ResumePayload, config?: AgentResumeStreamConfig): Promise<void> => {
    const record = resolveFocusedApprovalRecord();
    if (!record) {
      throw new Error('No queued approval is available for the current session');
    }

    if (record.source === 'task_run') {
      if (!taskRuntime) {
        throw new Error('Task approval runtime is not available');
      }
      await taskRuntime.resumeApprovalById(record.approvalId, payload, config);
      return;
    }

    if (!teamRuntime) {
      throw new Error('Team approval runtime is not available');
    }

    await teamRuntime.resumeApprovalById(record.approvalId, payload);
    resolveFocusedApprovalRecord();
  };

  return {
    ...session, subscribeRuntimeEvents, listCommands: commands.listCommands, executeCommand,
    listSessions: async (opts?: import('@durability/session').SessionListOptions) => options.store ? options.store.list(opts) : [],
    getMcpStatus: () => mcpManager?.status() ?? [],
    getTaskRunSummaries: () => getTaskRunSummaries(preloadedSources?.taskRunStore, session.getState().sessionId),
    getApprovalSummaries: () => getApprovalSummaries(
      approvalStore,
      session.getState().sessionId,
      resolveFocusedApprovalRecord()?.approvalId ?? readForegroundApprovalId(),
    ),
    getFocusedApprovalReview,
    focusApproval: async (approvalId: string) => {
      const record = approvalStore?.get(approvalId);
      if (!record || record.sessionId !== session.getState().sessionId) {
        throw new Error(`Approval "${approvalId}" not found for current session`);
      }
      focusedApprovalId = approvalId;
    },
    resumeApproval,
    resumeApprovalStream,
    getTeamSummaries: () => getTeamSummaries(preloadedSources?.teamRegistry),
    getTeamDetail: (teamId: string) => getTeamDetail(
      preloadedSources?.teamRegistry,
      teamId,
    ),
    getMemberMessages: (memberId: string) => teamRuntime?.getMemberMessages(memberId) ?? [],
    getChannelRegistry: () => channelRegistry,
    dispose,
  };
}

async function reopenCodaraSession(options: CodaraOptions, state: SessionState): Promise<Codara> {
  const codara = assembleCodara({...options, sessionId: state.sessionId, restore: 'latest'}, state);
  await codara.hydrate();
  return codara;
}

function normalizeAlias(alias: string | undefined): string {
  return alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
}

function resolveCodaraRuntimePath(options: Pick<CodaraRuntimeOptions, 'codaraPath' | 'cwd' | 'projectRoot'>): string {
  if (options.codaraPath?.trim()) return path.resolve(options.codaraPath.trim());
  const projectRoot = resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});
  const projectCodaraPath = path.join(projectRoot, '.codara');
  if (existsSync(path.join(projectCodaraPath, 'config.json'))) return projectCodaraPath;
  return path.resolve(resolveCodaraPath());
}
