import {existsSync} from 'node:fs';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentContextPreparer} from '@engine/agent';
import type {AgentCheckpointer} from '@infra/checkpoint';
import {createAgentFileCheckpointer} from '@infra/checkpoint';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@engine/pipeline';
import type {SummarySettings} from '@engine/pipeline/summary';
import {
  createBudgetMiddleware,
  createDailySessionFileLogSink,
  createGuidelinesMiddleware,
  createHILMiddleware,
  createAskUserQuestionMiddleware,
  createLoggingMiddleware,
  createSkillsMiddleware,
  MIDDLEWARE_NAMES,
  createTodoListMiddleware,
} from '@engine/pipeline';
import {
  ensurePermissionSettingsFile,
  createPermissionMiddleware,
} from '@engine/pipeline/permission';
import {
  createSharedTaskMiddleware,
  createTaskFileStore,
  createTaskMiddleware,
  type TaskStore,
} from '@capability/task';
import {ChatModelFactory, loadModelRoutingConfig, loadModelRoutingConfigFromPath, ModelRegistry, resolveCodaraPath, type ModelInfo, type ModelRoutingConfig} from '@infra/provider';
import {
  createCodaraGuidelinesSource,
  type GuidelinesSource,
} from '@infra/context/instructions/guidelines';
import {
  createCodaraPromptSource,
  type PromptSource,
} from '@infra/context/instructions/prompt';
import {
  createAutoMemoryRuntime,
  type AutoMemoryRuntime,
} from '@infra/context/memory/auto-memory';
import {
  createCodaraSkillsSource,
  FileSystemSkillStore,
  type SkillStore,
} from '@capability/skill';
import {createSkillCodaraCommands} from '@capability/command/skills';
import {createCodaraCommandRunner, type CodaraCommandResult, type CodaraCommandSpec} from '@capability/command';
import {
  createSession,
  FileSessionStore,
  type CodaraRuntimeEvent,
  type CodaraRuntimeEventListener,
  type Session,
  type SessionState,
  type SessionStore,
} from '@engine/session';
import {resolveWorkspaceRoot} from '@infra/config/workspace';
import {createBuiltinTools} from '@capability/tool';
import {
  applyPreparedInstructionContext,
  buildBaseSystemMessage,
} from '@infra/context/system-message';
import {HookRegistryImpl, HookPipeline, createToolHooksMiddleware, createHookExecutor} from '@engine/hook';
import type {HookSource, HookRegistry, SessionLifecycleHooks, AgentLifecycleHooks} from '@engine/hook';
import {loadMcpConfig, createMcpManager, createMcpLangChainTools, type McpClientInfo, type McpConfig, type McpManager} from '@engine/mcp';
import {TeamRegistry} from '@capability/team/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {RemotePool} from '@capability/team/remote-pool';
import {createConversationTeamTools} from '@capability/team/tools/conversation-tools';
import {MemorySharedState} from '@capability/team/state/memory-shared-state';
import {TeamEventBridge} from '@capability/team/bridge/team-event-bridge';
import {getToolsForRole} from '@capability/team/tools/tool-filter';
import {createTeamContextMiddleware} from '@capability/team/middleware/team-context';
import type {MemberSession, MemberSessionOptions} from '@capability/team/runtime/member-runner';
import {createAgent} from '@engine/agent/run/agent-loop';
import {TeamStore} from '@capability/team/persistence/team-store';
import {MemberStore} from '@capability/team/persistence/member-store';
import {JobBoardStore} from '@capability/team/persistence/job-board-store';
import {createTeamBudgetMiddleware} from '@capability/team/budget/team-budget-middleware';
import {createPathGuardMiddleware} from '@capability/team/security/path-guard-middleware';

export const DEFAULT_CODARA_MODEL_ALIAS = 'default';
const DEFAULT_RUNTIME_FILE_LOGGING_ENABLED = true;

export class CodaraModelCatalog {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly factory: ChatModelFactory,
  ) {}

  create(alias = DEFAULT_CODARA_MODEL_ALIAS): Promise<BaseChatModel> {
    return this.factory.create(normalizeAlias(alias));
  }

  getInfo(alias = DEFAULT_CODARA_MODEL_ALIAS): ModelInfo {
    return this.registry.getByAlias(normalizeAlias(alias));
  }

  hasAlias(alias: string): boolean {
    return this.registry.hasAlias(normalizeAlias(alias));
  }

  getAliases(): string[] {
    return this.registry.getAliases();
  }
}

export interface CodaraSkillOptions {
  store?: SkillStore;
  sources?: string[];
  subagentRoots?: string[];
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  cacheTtlMs?: number;
  /** 启用后额外扫描 ~/.claude/skills/（Claude Code 兼容），默认关闭。 */
  claudeSkillsCompat?: boolean;
}

export interface CodaraAutoMemoryOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  autoGlobal?: boolean;
  rootDir?: string;
}

export interface CodaraOptions {
  id?: string;
  config?: ModelRoutingConfig;
  alias?: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  tools?: StructuredToolInterface[];
  builtinTools?: boolean;
  middleware?: BaseMiddleware[];
  skills?: false | CodaraSkillOptions;
  summary?: false | SummarySettings;
  hil?: false | HILMiddlewareOptions;
  logging?: false | LoggingMiddlewareOptions;
  sessionId?: string;
  restore?: 'latest' | 'never';
  store?: SessionStore;
  checkpointer?: AgentCheckpointer;
  handleToolErrors?: boolean;
  inputBudget?: import('@engine/agent').AgentInputBudget;
  messages?: import('@engine/agent').AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  autoMemory?: false | CodaraAutoMemoryOptions;
  /** MCP server configuration. `false` to disable, omit for auto-detection from .codara/mcp.json. */
  mcp?: false | McpConfig;
}

export interface CodaraRuntimeOptions extends CodaraOptions {
  codaraPath?: string;
  taskStore?: TaskStore;
}

export type CreateCodaraModelCatalogOptions = Pick<CodaraOptions, 'config'>;

export type CreateCodaraChatModelOptions =
  Pick<CodaraOptions, 'alias' | 'config'>
  & {
    catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  };

export type CodaraToolsOptions = Pick<CodaraOptions, 'builtinTools' | 'cwd' | 'tools'>;

export type CodaraMiddlewareOptions = Pick<CodaraOptions, 'middleware' | 'hil' | 'logging'>;

export interface TeamQuerySummary {
  teamId: string;
  name: string;
  status: string;
  goal: string;
  memberCount: number;
  jobProgress: { done: number; total: number };
}

export interface TeamQueryMember {
  memberId: string;
  name: string;
  role: string;
  status: string;
  model?: string;
  currentJobId?: string;
}

export interface TeamQueryJob {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  blockedBy: string[];
}

export interface TeamQueryDetail {
  teamId: string;
  name: string;
  status: string;
  goal: string;
  members: TeamQueryMember[];
  jobs: TeamQueryJob[];
}

export type Codara = Session & {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
  listSessions(options?: import('@engine/session').SessionListOptions): Promise<SessionState[]>;
  getMcpStatus(): McpClientInfo[];
  getTeamSummaries(): TeamQuerySummary[];
  getTeamDetail(teamId: string): TeamQueryDetail | undefined;
};

export async function createCodaraModelCatalog(
  options: CreateCodaraModelCatalogOptions = {},
): Promise<CodaraModelCatalog> {
  const config = options.config ?? (await loadModelRoutingConfig());
  const registry = new ModelRegistry(config);
  return new CodaraModelCatalog(registry, new ChatModelFactory(registry));
}

export async function createCodaraChatModel(
  options: CreateCodaraChatModelOptions = {},
): Promise<BaseChatModel> {
  const catalog = await (options.catalog ?? createCodaraModelCatalog(options));
  return catalog.create(options.alias);
}

export function createCodara(options: CodaraOptions = {}): Codara {
  return assembleCodara(options);
}

export async function createCodaraRuntime(options: CodaraRuntimeOptions = {}): Promise<Codara> {
  const codaraPath = resolveCodaraRuntimePath(options);
  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const guidelinesSource = createCodaraGuidelinesSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  });
  const promptSource = createCodaraPromptSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  });
  const taskStore = options.taskStore ?? createTaskFileStore({
    rootDir: path.join(projectRoot, '.codara', 'tasks'),
  });
  ensurePermissionSettingsFile({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  });
  const catalog = !options.model && !options.catalog && !options.config
    ? loadModelRoutingConfigFromPath(codaraPath).then((config) => createCodaraModelCatalog({config}))
    : options.catalog;
  const logging = resolveRuntimeLoggingOptions(options);
  const runtimeTools: StructuredToolInterface[] = createCodaraTools({
    builtinTools: options.builtinTools,
    cwd: options.cwd,
    tools: options.tools,
  });
  // ── Hooks System Assembly ──
  const hookSources: HookSource[] = [];
  const projectHooksPath = path.join(codaraPath, 'hooks.json');
  hookSources.push({kind: 'project', path: projectHooksPath});
  const userHome = options.userHome ?? process.env.HOME ?? '';
  if (userHome) {
    const userHooksPath = path.join(userHome, '.codara', 'hooks.json');
    hookSources.push({kind: 'user', path: userHooksPath});
  }
  const hookRegistry = new HookRegistryImpl();
  await hookRegistry.load(hookSources);
  const hookPipeline = new HookPipeline(hookRegistry, {
    createStrategy: (hook) => createHookExecutor(hook, {projectRoot: codaraPath}),
  });

  // ── MCP Assembly ──
  let mcpManager: McpManager | undefined;
  if (options.mcp !== false) {
    const mcpConfig = options.mcp ?? await loadMcpConfig({
      projectRoot,
      userHome: options.userHome,
    });
    if (Object.keys(mcpConfig.mcpServers).length > 0) {
      mcpManager = createMcpManager(mcpConfig);
      await mcpManager.init();
      // Inject MCP tools into the runtime tool set
      const mcpTools = createMcpLangChainTools(mcpManager);
      runtimeTools.push(...mcpTools);
    }
  }

  // ── Team System Assembly ──
  const teamRegistry = new TeamRegistry();
  const sharedState = new MemorySharedState();

  // Session factory: creates real agent sessions for team members.
  // Uses createAgent directly (same pattern as Task delegation) so we can
  // pass runtimeShared.teamContext for TeamContextMiddleware to read.
  const teamSessionFactory = (memberOptions: MemberSessionOptions): MemberSession => {
    const teamToolContext = {
      teamId: memberOptions.teamId,
      memberId: memberOptions.memberId,
      registry: teamRegistry,
      transport: teamRuntime.getTransport(memberOptions.teamId)!,
      emitter: teamRuntime.getEmitter(memberOptions.teamId)!,
      projectRoot,
    };

    // Role-based tool injection:
    // - Leader: only coordination tools (plan_jobs, assign, review, etc.)
    // - Worker: dev tools (bash, read, write...) + worker team tools (claim, submit...)
    const baseDevTools = createBuiltinTools({
      cwd: memberOptions.worktreePath ?? options.cwd,
      extended: true,
    });
    const memberTools = getToolsForRole(memberOptions.role, teamToolContext, baseDevTools);

    // Middleware: team context injection + context budget + team budget tracking + path guard
    const memberMiddleware: BaseMiddleware[] = [
      createTeamContextMiddleware(),
      createBudgetMiddleware(),
    ];

    // Filesystem isolation: workers with worktrees can only access their own workspace
    if (memberOptions.worktreePath && memberOptions.role === 'worker') {
      memberMiddleware.push(createPathGuardMiddleware(memberOptions.worktreePath));
    }

    // Wire team-level budget tracker (records actual LLM token costs)
    const budgetTracker = teamRuntime.getBudgetTracker(memberOptions.teamId);
    if (budgetTracker) {
      memberMiddleware.push(createTeamBudgetMiddleware({
        tracker: budgetTracker,
        memberId: memberOptions.memberId,
        model: 'claude-sonnet-4-6', // default; overridden when model resolves
        onBudgetAction: (result) => {
          const emitter = teamRuntime.getEmitter(memberOptions.teamId);
          if (result.action === 'exceeded') {
            const policy = budgetTracker.getExceededPolicy();
            emitter?.emit({
              type: 'team.budget.exceeded',
              data: {teamId: memberOptions.teamId, action: policy === 'warn_leader' ? 'warn' : policy},
            });
            if (policy === 'pause') {
              teamRuntime.pauseTeam(memberOptions.teamId);
            } else if (policy === 'shutdown') {
              teamRuntime.shutdownTeam(memberOptions.teamId).catch(() => {});
            }
          } else if (result.action === 'warning') {
            emitter?.emit({
              type: 'team.budget.warning',
              data: {teamId: memberOptions.teamId, usedPercent: result.usedPercent, remaining: result.remaining},
            });
          }
        },
      }));
    }

    // Resolve model lazily — reuse the same catalog as the main agent
    let agentReady: ReturnType<typeof createAgent> | undefined;

    const ensureAgent = async () => {
      if (agentReady) return agentReady;

      const model = catalog
        ? await (await catalog).create()
        : options.model
          ? await Promise.resolve(options.model)
          : (() => { throw new Error('No model available for team worker'); })();

      agentReady = createAgent({
        model,
        agentType: 'subagent',
        tools: memberTools,
        middleware: memberMiddleware,
        systemMessage: memberOptions.systemMessage.length > 0
          ? memberOptions.systemMessage
          : undefined,
        runtimeShared: memberOptions.runtimeShared,
      });
      return agentReady;
    };

    // Adapt Agent → MemberSession interface
    return {
      async invoke(input?: string) {
        try {
          const agent = await ensureAgent();
          const result = await agent.invoke(input ?? undefined);
          if (result.reason === 'error') {
            return {reason: 'error' as const, error: result.error};
          }
          return {reason: 'complete' as const};
        } catch (err) {
          return {reason: 'error' as const, error: err instanceof Error ? err : new Error(String(err))};
        }
      },
      async dispose() {
        // Agent doesn't have explicit dispose; release reference
        agentReady = undefined;
      },
    };
  };

  const teamsDir = path.join(codaraPath, 'teams');
  const teamStore = new TeamStore(teamsDir);
  const memberStore = new MemberStore(teamsDir);
  const jobBoardStore = new JobBoardStore(teamsDir);

  const teamRuntime = new TeamRuntime({
    registry: teamRegistry,
    projectRoot,
    teamsDir,
    createSession: teamSessionFactory,
    persistence: { teamStore, memberStore, jobBoardStore },
  });
  // Recover persisted teams into registry (best-effort)
  try {
    const savedTeams = teamStore.loadRegistry();
    for (const entry of savedTeams) {
      const fullTeam = teamStore.load(entry.teamId);
      if (fullTeam && (fullTeam.status === 'running' || fullTeam.status === 'paused')) {
        // Mark as paused — user must explicitly resume
        fullTeam.status = 'paused';
        teamRegistry.restoreTeam(fullTeam);
        // Restore members
        const savedMembers = memberStore.loadByTeam(entry.teamId);
        for (const m of savedMembers) {
          teamRegistry.restoreMember(m);
        }
        // Restore job board
        const savedBoard = jobBoardStore.load(entry.teamId);
        if (savedBoard) {
          teamRegistry.restoreJobBoard(entry.teamId, savedBoard);
        }
      }
    }
  } catch {
    // Recovery is best-effort — fresh start if it fails
  }

  const remotePool = new RemotePool(codaraPath);
  await remotePool.load();

  // Add conversation-driven team tools
  const teamTools = createConversationTeamTools({registry: teamRegistry, runtime: teamRuntime, sharedState});
  for (const t of teamTools) runtimeTools.push(t);

  const runtimeMiddlewares = createRuntimeDefaultMiddlewares({
    options,
    runtimeTools,
    taskStore,
    logging,
    catalog,
    promptSource,
    guidelinesSource,
    hookPipeline,
  });

  return assembleCodara({
    ...options,
    tools: runtimeTools,
    middleware: runtimeMiddlewares,
    hil: false,
    autoMemory: options.autoMemory === false
      ? false
      : (typeof options.autoMemory === 'object' && options.autoMemory !== null ? options.autoMemory : {}),
    summary: options.summary === false ? false : (options.summary ?? {}),
    ...(logging === false ? {logging: false} : {logging}),
    ...(catalog ? {catalog} : {}),
    ...(options.store ? {} : {store: new FileSessionStore({basePath: path.join(codaraPath, 'sessions')})}),
    ...(options.checkpointer ? {} : {
      checkpointer: createAgentFileCheckpointer({rootDir: path.join(codaraPath, 'sessions')}),
    }),
    restore: options.restore ?? 'latest',
  }, undefined, {promptSource, guidelinesSource, hookPipeline, hookRegistry, mcpManager, teamRegistry, teamRuntime, remotePool});
}

function assembleCodara(
  options: CodaraOptions,
  restoredState?: SessionState,
  preloadedSources?: {
    promptSource?: PromptSource;
    guidelinesSource?: GuidelinesSource;
    hookPipeline?: HookPipeline;
    hookRegistry?: HookRegistry;
    mcpManager?: McpManager;
    teamRegistry?: TeamRegistry;
    teamRuntime?: TeamRuntime;
    remotePool?: RemotePool;
  },
): Codara {
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;
  const autoMemory = resolveCodaraAutoMemory(options);
  const alias = normalizeAlias(options.alias);
  const guidelinesSource = preloadedSources?.guidelinesSource ?? createCodaraGuidelinesSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  });
  const promptSource = preloadedSources?.promptSource ?? createCodaraPromptSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  });
  const tools = createCodaraTools(options);
  const session = createSession({
    ...(restoredState ? {state: restoredState} : {}),
    id: options.id,
    sessionId: options.sessionId,
    store: options.store,
    checkpointer: options.checkpointer,
    restore: options.restore,
    messages: options.messages,
    context: options.context,
    values: options.values,
    modelRef: alias,
    ...(options.model ? {model: options.model} : {}),
    ...(!options.model ? {modelCatalog: options.catalog ?? createCodaraModelCatalog({config: options.config})} : {}),
    guidelinesSource,
    promptSource,
    ...(skillsSource ? {skillsSource} : {}),
    ...(autoMemory ? {autoMemory} : {}),
    tools,
    ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
    middleware: createCodaraMiddlewares(options),
    ...(options.summary ? {summary: options.summary} : {}),
    ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
    ...(preloadedSources?.hookPipeline ? {lifecycle: preloadedSources.hookPipeline as SessionLifecycleHooks & AgentLifecycleHooks} : {}),
  });

  // Wrap session with extra properties for commands that need it (/reload, /hooks, /mcp)
  const mcpManager = preloadedSources?.mcpManager;
  const extraProps: Record<string, PropertyDescriptor> = {};
  if (preloadedSources?.hookRegistry) {
    extraProps.hookRegistry = {value: preloadedSources.hookRegistry, writable: false};
  }
  if (mcpManager) {
    extraProps.getMcpStatus = {value: () => mcpManager.status(), writable: false};
  }
  if (preloadedSources?.teamRegistry) {
    extraProps.teamRegistry = {value: preloadedSources.teamRegistry, writable: false};
  }
  if (preloadedSources?.teamRuntime) {
    extraProps.teamRuntime = {value: preloadedSources.teamRuntime, writable: false};
  }
  if (preloadedSources?.remotePool) {
    extraProps.remotePool = {value: preloadedSources.remotePool, writable: false};
  }
  const commandAgent = Object.keys(extraProps).length > 0
    ? Object.create(session, extraProps)
    : session;

  const commands = createCodaraCommandRunner({
    agent: commandAgent,
    environment: {
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome: options.userHome,
      modelAlias: alias,
    },
    ...(skillsSource ? {getDynamicCommands: () => createSkillCodaraCommands(skillsSource)} : {}),
  });

  const commandEventListeners = new Set<CodaraRuntimeEventListener>();
  const subscribeRuntimeEvents = (listener: CodaraRuntimeEventListener) => {
    const unsubscribeSession = session.subscribeRuntimeEvents(listener);
    commandEventListeners.add(listener);
    return () => {
      unsubscribeSession();
      commandEventListeners.delete(listener);
    };
  };

  const emitCommandEvent = (input: Omit<CodaraRuntimeEvent, 'sessionId' | 'timestamp'>) => {
    const event: CodaraRuntimeEvent = {
      ...input,
      sessionId: session.getState().sessionId,
      timestamp: new Date().toISOString(),
    };
    for (const listener of commandEventListeners) {
      listener(event);
    }
  };

  const executeCommand = async (input: string): Promise<CodaraCommandResult> => {
    const commandEventId = `command:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    emitCommandEvent({
      id: commandEventId,
      kind: 'command',
      phase: 'start',
      status: 'running',
      label: `Running ${input.trim()}`,
    });

    const result = await commands.executeCommand(input);
    emitCommandEvent({
      id: `command:end:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind: 'command',
      phase: 'end',
      status: result.ok ? 'done' : 'error',
      label: result.ok ? `Completed ${input.trim()}` : `Failed ${input.trim()}`,
      detail: summarizeCommandResult(result),
      parentId: commandEventId,
    });
    return result;
  };

  const sessionStore = options.store;
  const listSessions = async (listOptions?: import('@engine/session').SessionListOptions): Promise<SessionState[]> => {
    if (!sessionStore) {
      return [];
    }
    return sessionStore.list(listOptions);
  };

  const getMcpStatus = (): McpClientInfo[] => mcpManager?.status() ?? [];

  // ── Team Event Bridge ──
  // Bridge TeamEventEmitter events into the main runtime event stream.
  // The bridge is only created when a TeamRuntime is present (i.e. createCodaraRuntime path).
  const teamRuntime = preloadedSources?.teamRuntime;
  let teamEventBridge: TeamEventBridge | undefined;
  if (teamRuntime) {
    teamEventBridge = new TeamEventBridge({
      sessionId: session.getState().sessionId,
      onRuntimeEvent: (event) => {
        for (const listener of commandEventListeners) {
          listener(event);
        }
      },
    });

    // Patch startTeam to auto-attach and replay the start event
    // (team.running is emitted inside startTeam before the bridge can attach)
    const originalStartTeam = teamRuntime.startTeam.bind(teamRuntime);
    teamRuntime.startTeam = async (teamId: string): Promise<void> => {
      await originalStartTeam(teamId);
      const emitter = teamRuntime.getEmitter(teamId);
      if (emitter) {
        teamEventBridge!.attachTeam(teamId, emitter);
        // Replay the team.running event that was emitted before bridge attachment
        emitter.emit({type: 'team.running', data: {teamId}});
      }
    };

    // Patch shutdownTeam to auto-detach
    const originalShutdownTeam = teamRuntime.shutdownTeam.bind(teamRuntime);
    teamRuntime.shutdownTeam = async (teamId: string): Promise<void> => {
      await originalShutdownTeam(teamId);
      teamEventBridge!.detachTeam(teamId);
    };

    // Patch killTeam to auto-detach
    const originalKillTeam = teamRuntime.killTeam.bind(teamRuntime);
    teamRuntime.killTeam = async (teamId: string): Promise<void> => {
      await originalKillTeam(teamId);
      teamEventBridge!.detachTeam(teamId);
    };
  }

  const getTeamSummaries = (): TeamQuerySummary[] => {
    const registry = preloadedSources?.teamRegistry;
    if (!registry) return [];
    return registry.listTeams().map(t => {
      const board = registry.getJobBoard(t.teamId);
      const progress = board.getProgress();
      const members = registry.getMembersByTeam(t.teamId);
      return {
        teamId: t.teamId,
        name: t.name,
        status: t.status,
        goal: t.goal,
        memberCount: members.length,
        jobProgress: { done: progress.done, total: progress.total },
      };
    });
  };

  const getTeamDetail = (teamId: string): TeamQueryDetail | undefined => {
    const registry = preloadedSources?.teamRegistry;
    if (!registry) return undefined;
    const team = registry.getTeam(teamId) ?? registry.getTeamByName(teamId);
    if (!team) return undefined;
    const members = registry.getMembersByTeam(team.teamId);
    const board = registry.getJobBoard(team.teamId);
    const jobs = board.getAllJobs();
    return {
      teamId: team.teamId,
      name: team.name,
      status: team.status,
      goal: team.goal,
      members: members.map(m => ({
        memberId: m.memberId,
        name: m.name,
        role: m.role,
        status: m.status,
        model: m.model,
        currentJobId: m.currentJobId,
      })),
      jobs: jobs.map(j => ({
        id: j.id,
        title: j.title,
        status: j.status,
        assignee: j.assignee,
        blockedBy: j.blockedBy,
      })),
    };
  };

  const dispose = async (): Promise<void> => {
    teamEventBridge?.detachAll();
    await session.dispose();
    if (mcpManager) {
      await mcpManager.dispose();
    }
  };

  return {
    ...session,
    subscribeRuntimeEvents,
    listCommands: commands.listCommands,
    executeCommand,
    listSessions,
    getMcpStatus,
    getTeamSummaries,
    getTeamDetail,
    dispose,
  };
}

function resolveCodaraAutoMemory(options: CodaraOptions): AutoMemoryRuntime | undefined {
  if (options.autoMemory === false) {
    return undefined;
  }

  const memOpts = typeof options.autoMemory === 'object' && options.autoMemory !== null
    ? options.autoMemory
    : {};

  return createAutoMemoryRuntime({
    cwd: memOpts.cwd ?? options.cwd,
    projectRoot: memOpts.projectRoot ?? options.projectRoot,
    userHome: memOpts.userHome ?? options.userHome,
    autoGlobal: memOpts.autoGlobal,
    rootDir: memOpts.rootDir,
  });
}

export async function openCodaraSession(
  options: CodaraOptions & {sessionId: string; store: SessionStore},
): Promise<Codara> {
  const sessionState = await options.store.get(options.sessionId);
  if (!sessionState) {
    throw new Error(`Session not found: ${options.sessionId}`);
  }
  return reopenCodaraSession(options, sessionState);
}

export async function openLatestCodaraSession(
  options: CodaraOptions & {store: SessionStore},
): Promise<Codara> {
  const sessions = await options.store.list({
    includeArchived: true,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const latest = sessions.find((session) => session.sessionStatus !== 'closed') ?? sessions[0];
  if (!latest) {
    throw new Error('No sessions found');
  }
  return reopenCodaraSession(options, latest);
}

export function createCodaraTools(options: CodaraToolsOptions = {}): StructuredToolInterface[] {
  if (options.builtinTools === false) {
    return [...(options.tools ?? [])];
  }

  const byName = new Map<string, StructuredToolInterface>();
  for (const tool of createBuiltinTools({cwd: options.cwd, extended: true})) {
    byName.set(tool.name, tool);
  }
  for (const tool of options.tools ?? []) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  if (options.logging) {
    middlewares.push(createLoggingMiddleware(options.logging as LoggingMiddlewareOptions));
  }
  // SkillsMiddleware — Skill tool for progressive disclosure.
  // Reads runtime from shared context (injected by SkillsSource via buildBaseSystemMessage).
  if (!options.middleware?.some((m) => m.name === MIDDLEWARE_NAMES.Skills)) {
    middlewares.push(createSkillsMiddleware());
  }
  middlewares.push(...(options.middleware ?? []));
  middlewares.push(createBudgetMiddleware());
  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }
  return middlewares;
}

function resolveCodaraSkills(
  options: Pick<CodaraOptions, 'skills' | 'cwd' | 'projectRoot' | 'userHome'>,
): {store: SkillStore; subagentRoots: string[]} | undefined {
  if (options.skills === false) {
    return undefined;
  }
  if (options.skills?.store) {
    return {store: options.skills.store, subagentRoots: options.skills.subagentRoots ?? []};
  }
  return {
    store: new FileSystemSkillStore({
      ...(options.skills?.sources ? {sources: options.skills.sources} : {}),
      ...((options.skills?.projectRoot || options.projectRoot || options.skills?.cwd || options.cwd)
        ? {
            projectRoot: resolveWorkspaceRoot({
              projectRoot: options.skills?.projectRoot ?? options.projectRoot,
              cwd: options.skills?.cwd ?? options.cwd,
            }),
          }
        : {}),
      ...((options.skills?.cwd || options.cwd) ? {cwd: options.skills?.cwd ?? options.cwd} : {}),
      ...((options.skills?.userHome || options.userHome) ? {userHome: options.skills?.userHome ?? options.userHome} : {}),
      ...(typeof options.skills?.cacheTtlMs === 'number' ? {cacheTtlMs: options.skills.cacheTtlMs} : {}),
      ...(options.skills?.claudeSkillsCompat ? {claudeSkillsCompat: true} : {}),
    }),
    subagentRoots: options.skills?.subagentRoots ?? [],
  };
}

async function reopenCodaraSession(options: CodaraOptions, state: SessionState): Promise<Codara> {
  const codara = assembleCodara({
    ...options,
    sessionId: state.sessionId,
    restore: 'latest',
  }, state);
  await codara.hydrate();
  return codara;
}

function normalizeAlias(alias: string | undefined): string {
  return alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
}


function resolveCodaraRuntimePath(options: Pick<CodaraRuntimeOptions, 'codaraPath' | 'cwd' | 'projectRoot'>): string {
  if (options.codaraPath?.trim()) {
    return path.resolve(options.codaraPath.trim());
  }

  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const projectCodaraPath = path.join(projectRoot, '.codara');
  if (existsSync(path.join(projectCodaraPath, 'config.json'))) {
    return projectCodaraPath;
  }

  return path.resolve(resolveCodaraPath());
}

function resolveRuntimeLoggingOptions(
  options: Pick<CodaraRuntimeOptions, 'logging' | 'cwd' | 'projectRoot'>,
): false | LoggingMiddlewareOptions {
  if (!DEFAULT_RUNTIME_FILE_LOGGING_ENABLED || options.logging === false || options.logging?.enabled === false) {
    return false;
  }

  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const rootDir = path.join(projectRoot, '.codara', 'sessions');
  const provided = options.logging ?? {};

  return {
    ...provided,
    enabled: true,
    logger: provided.logger ?? createDailySessionFileLogSink({rootDir}),
  };
}

function createRuntimeDefaultMiddlewares(input: {
  options: CodaraRuntimeOptions;
  runtimeTools: StructuredToolInterface[];
  taskStore: TaskStore;
  logging: false | LoggingMiddlewareOptions;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  promptSource: PromptSource;
  guidelinesSource: GuidelinesSource;
  hookPipeline?: HookPipeline;
}): BaseMiddleware[] {
  const callerMiddlewares = input.options.middleware ?? [];
  const byName = new Map<string, BaseMiddleware>();
  const providedToolNames = collectProvidedToolNames({
    tools: input.options.tools,
    middlewares: callerMiddlewares,
  });
  for (const middleware of callerMiddlewares) {
    byName.set(middleware.name, middleware);
  }

  // GuidelinesMiddleware — lazy loading of subdirectory AGENTS.md / codara.md
  if (!byName.has(MIDDLEWARE_NAMES.Guidelines)) {
    byName.set(MIDDLEWARE_NAMES.Guidelines, createGuidelinesMiddleware({
      guidelinesSource: input.guidelinesSource,
      promptSource: input.promptSource,
    }));
  }

  if (!byName.has(MIDDLEWARE_NAMES.TodoList) && !providedToolNames.has('write_todos')) {
    byName.set(MIDDLEWARE_NAMES.TodoList, createTodoListMiddleware());
  }

  if (!byName.has(MIDDLEWARE_NAMES.SharedTask) && !hasSharedTaskTools(providedToolNames)) {
    byName.set(MIDDLEWARE_NAMES.SharedTask, createSharedTaskMiddleware({store: input.taskStore}));
  }

  if (!byName.has(MIDDLEWARE_NAMES.Task) && !providedToolNames.has('Task')) {
    byName.set(MIDDLEWARE_NAMES.Task, createTaskMiddleware({
      model: input.options.model ?? (() => createCodaraChatModel({
        alias: input.options.alias,
        config: input.options.config,
        ...(input.catalog ? {catalog: input.catalog} : {}),
      })),
      tools: input.runtimeTools,
      prepareContext: createInstructionContextPreparer({
        promptSource: input.promptSource,
        guidelinesSource: input.guidelinesSource,
      }),
      middleware: createDelegatedRuntimeMiddlewares({
        ...input,
        tools: input.runtimeTools,
        catalog: input.catalog,
      }),
    }));
  }

  if (input.options.hil !== false && !byName.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    byName.set(MIDDLEWARE_NAMES.AskUserQuestion, createAskUserQuestionMiddleware());
  }

  if (input.options.hil !== false && !byName.has(MIDDLEWARE_NAMES.Permission)) {
    byName.set(MIDDLEWARE_NAMES.Permission, createPermissionMiddleware({
      ...(typeof input.options.hil === 'object' && input.options.hil !== null ? input.options.hil : {}),
      cwd: input.options.cwd,
      projectRoot: input.options.projectRoot,
      userHome: input.options.userHome,
      bashAnalysisModel: createRuntimePermissionAnalysisModel(input.options, input.catalog),
    }));
  }

  // Add ToolHooksMiddleware after Permission (last in the chain)
  if (input.hookPipeline) {
    byName.set(MIDDLEWARE_NAMES.ToolHooks, createToolHooksMiddleware(input.hookPipeline));
  }

  return [...byName.values()];
}

function createDelegatedRuntimeMiddlewares(input: {
  options: CodaraRuntimeOptions;
  taskStore: TaskStore;
  logging: false | LoggingMiddlewareOptions;
  tools?: StructuredToolInterface[];
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  const callerMiddlewares = (input.options.middleware ?? [])
    .filter((middleware) => middleware.name !== MIDDLEWARE_NAMES.Task);
  const providedToolNames = collectProvidedToolNames({
    tools: input.tools,
    middlewares: callerMiddlewares,
  });

  const seen = new Set<string>();
  const push = (middleware: BaseMiddleware) => {
    if (seen.has(middleware.name)) {
      return;
    }
    seen.add(middleware.name);
    middlewares.push(middleware);
  };

  if (input.logging && input.logging.enabled !== false) {
    push(createLoggingMiddleware(input.logging));
  }

  for (const middleware of callerMiddlewares) {
    push(middleware);
  }

  if (!seen.has(MIDDLEWARE_NAMES.TodoList) && !providedToolNames.has('write_todos')) {
    push(createTodoListMiddleware());
  }
  if (!seen.has(MIDDLEWARE_NAMES.SharedTask) && !hasSharedTaskTools(providedToolNames)) {
    push(createSharedTaskMiddleware({store: input.taskStore}));
  }
  if (input.options.hil !== false && !seen.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    push(createAskUserQuestionMiddleware());
  }
  if (input.options.hil !== false && !seen.has(MIDDLEWARE_NAMES.Permission)) {
    push(createPermissionMiddleware({
      ...(typeof input.options.hil === 'object' && input.options.hil !== null ? input.options.hil : {}),
      cwd: input.options.cwd,
      projectRoot: input.options.projectRoot,
      userHome: input.options.userHome,
      bashAnalysisModel: createRuntimePermissionAnalysisModel(input.options, input.catalog),
    }));
  }

  push(createBudgetMiddleware());
  return middlewares;
}

function collectProvidedToolNames(input: {
  tools?: StructuredToolInterface[];
  middlewares?: BaseMiddleware[];
}): Set<string> {
  const names = new Set<string>();
  for (const tool of input.tools ?? []) {
    names.add(tool.name);
  }
  for (const middleware of input.middlewares ?? []) {
    for (const tool of middleware.tools ?? []) {
      names.add(tool.name);
    }
  }
  return names;
}

function hasSharedTaskTools(toolNames: ReadonlySet<string>): boolean {
  return toolNames.has('TaskCreate') || toolNames.has('TaskUpdate') || toolNames.has('TaskList');
}

function summarizeCommandResult(result: CodaraCommandResult): string | undefined {
  const output = result.output.trim();
  return output || undefined;
}

function createInstructionContextPreparer(sources: {
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
}): AgentContextPreparer | undefined {
  if (!sources.promptSource && !sources.guidelinesSource) {
    return undefined;
  }

  return async (context) => {
    const next = await buildBaseSystemMessage(sources.promptSource, sources.guidelinesSource);
    applyPreparedInstructionContext(context, next);
  };
}

function createRuntimePermissionAnalysisModel(
  options: Pick<CodaraRuntimeOptions, 'alias' | 'config' | 'model'>,
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>,
) {
  if (options.model) {
    return typeof options.model === 'function'
      ? options.model as () => Promise<BaseChatModel>
      : options.model;
  }

  if (catalog) {
    return () => createCodaraChatModel({
      alias: options.alias,
      config: options.config,
      catalog,
    });
  }

  return undefined;
}
