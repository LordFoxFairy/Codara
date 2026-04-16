import {existsSync} from 'node:fs';
import path from 'node:path';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgentFileCheckpointer} from '@durability/checkpoint';
import {createApprovalFileStore, type ApprovalStore} from '@durability/approval-store';
import {ensurePermissionSettingsFile} from '@core/middleware/permission';
import {createSubagentRunFileStore, createSubagentRunManager, type SubagentRunStore, type SubagentRunManager} from '@capability/subagent';
import {createTaskFileStore} from '@capability/task';
import {loadModelRoutingConfigFromPath, resolveCodaraPath} from '@integration/provider';
import {createCodaraGuidelinesSource, type GuidelinesSource, createCodaraPromptSource, type PromptSource} from '@context/sources';
import {createCodaraSkillsSource} from '@capability/skill';
import {createSkillCodaraCommands} from '@capability/command/runtime/skill-commands';
import {createCodaraCommandRunner, type CodaraCommandResult} from '@capability/command';
import {
  createSession, FileSessionStore,
  type SessionState, type SessionStore,
} from '@durability/session';
import type {CodaraRuntimeEvent, CodaraRuntimeEventListener} from '@observability/events';
import {CostTracker, type CostSnapshot} from '@observability/cost';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {HookRegistry, SessionLifecycleHooks, AgentLifecycleHooks} from '@observability/hook';
import {HookPipeline} from '@observability/hook';
import type {McpManager} from '@integration/mcp';
import type {ChannelRegistry} from '@integration/channel';
import type {DynamicSectionRegistry} from '@context/dynamic-sections';
import {MemoryWriter} from '@capability/memory/writer';
import {MemoryReader} from '@capability/memory/reader';
import {initSettings} from './runtime/init-settings';
import {initContextSources} from './runtime/init-context';
import {initHooks} from './runtime/init-hooks';
import {initMcp} from './runtime/init-mcp';
import {wireTranscript, wrapDispose} from './runtime/init-transcript';
import {createCostMiddleware} from '@core/middleware/cost';
import {createCodaraMiddlewares, createRuntimeDefaultMiddlewares, resolveRuntimeLoggingOptions,} from './assembly/middleware';
import {getSubagentRunDetails} from './assembly/subagent-run-details';
import {getSubagentRunSummaries} from './assembly/subagent-runs';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS,} from './assembly/runtime';
import {createCodaraTools} from './assembly/tools';
import {resolveCodaraSkills} from './assembly/context';
import {createCodaraReviewControl} from './review-control';
import {createCodaraInteractionStream} from './interaction-stream';
import {createDefaultAgentFactory, createDefaultMiddlewareFactory} from './agent-factory';
import type {
  Codara, CodaraOptions, CodaraRuntimeOptions,
} from './types';

// Re-export all types from types.ts for backward compatibility
export type {
  Codara, CodaraOptions, CodaraRuntimeOptions,
  CodaraSkillOptions, CodaraMiddlewareOptions, CodaraReviewOptions,
  CreateCodaraModelCatalogOptions, CreateCodaraChatModelOptions,
  CodaraPromptStreamRequest, CodaraContinuationStreamRequest,
  CodaraReviewStreamRequest, CodaraStreamRequest,
  ReviewBlockingScope,
  ReviewQueryItem,
  FocusedReviewQuery,
  SubagentRunQuerySummary,
  SubagentRunQueryDetail,
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
  const userHome = options.userHome ?? process.env.HOME ?? '';

  // 0. Unified Settings
  const {settings, settingsWatcher} = await initSettings(projectRoot, userHome);

  // 1. Context sources (guidelines, prompts, skills, dynamic sections)
  const context = await initContextSources(options, projectRoot, userHome);

  // 2. Persistence stores
  const taskStore = options.taskStore ?? createTaskFileStore({rootDir: path.join(runtimeStatePath, 'tasks')});
  const subagentRunStore = options.subagentRunStore ?? createSubagentRunFileStore({rootDir: path.join(runtimeStatePath, 'agent-runs')});
  const approvalStore = options.approvalStore ?? createApprovalFileStore({rootDir: path.join(runtimeStatePath, 'approvals')});
  const runtimeCheckpointer = options.checkpointer ?? createAgentFileCheckpointer({rootDir: path.join(runtimeStatePath, 'sessions')});
  const subagentRunManager = createSubagentRunManager({runStore: subagentRunStore, approvalStore});
  ensurePermissionSettingsFile({cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome});

  // 3. Model catalog
  const catalog = !options.model && !options.catalog && !options.config
    ? loadModelRoutingConfigFromPath(codaraPath).then((config) => createCodaraModelCatalog({config}))
    : options.catalog;

  // 4. Logging + tools
  const logging = resolveRuntimeLoggingOptions(options);
  const runtimeTools: StructuredToolInterface[] = createCodaraTools({
    builtinTools: options.builtinTools, cwd: options.cwd, tools: options.tools,
  });

  // Steps 5+ can fail — wrap in try/catch to clean up earlier resources
  let hooks: Awaited<ReturnType<typeof initHooks>> | undefined;
  let mcp: Awaited<ReturnType<typeof initMcp>> | undefined;

  try {
    // 5. Hooks
    hooks = await initHooks(settings, runtimeStatePath, userHome, codaraPath);

    // 6. MCP
    mcp = await initMcp(options.mcp, settings, projectRoot, userHome);
    runtimeTools.push(...mcp.mcpTools);

    // 7. Memory writer + reader
    const memoryDir = path.join(userHome, '.codara', 'memory');
    const memoryWriter = new MemoryWriter(memoryDir);
    const memoryReader = new MemoryReader(memoryDir);

    // 8. Middleware chain
    const runtimeMiddlewares = createRuntimeDefaultMiddlewares({
      options, runtimeTools, taskStore, subagentRunStore, subagentRunManager,
      subagentCheckpointer: runtimeCheckpointer, approvalStore, logging, catalog,
      promptSource: context.promptSource, guidelinesSource: context.guidelinesSource,
      skillsSource: context.skillsSource, hookPipeline: hooks.hookPipeline,
      channelRegistry: options.channelRegistry, memoryWriter, memoryReader,
    });

    // 9. Assemble facade
    let runtime = assembleCodara({
      ...options,
      tools: runtimeTools, middleware: runtimeMiddlewares, review: false,
      summary: options.summary === false ? false : (options.summary ?? {}),
      ...(logging === false ? {logging: false} : {logging}),
      ...(catalog ? {catalog} : {}),
      ...(options.store ? {} : {store: new FileSessionStore({basePath: path.join(runtimeStatePath, 'sessions')})}),
      ...(options.checkpointer ? {} : {checkpointer: runtimeCheckpointer}),
      restore: options.restore ?? 'latest',
    }, undefined, {
      promptSource: context.promptSource, guidelinesSource: context.guidelinesSource,
      hookPipeline: hooks.hookPipeline, hookRegistry: hooks.hookRegistry,
      mcpManager: mcp.mcpManager, subagentRunStore, subagentRunManager, approvalStore,
      channelRegistry: options.channelRegistry, dynamicSections: context.dynamicSections,
      memoryWriter, memoryReader,
    });

    // 10. Wire transcript + dispose chain
    const transcriptWriter = wireTranscript(runtime, projectRoot, userHome);
    const originalDispose = runtime.dispose;
    runtime = {...runtime, dispose: wrapDispose(originalDispose, transcriptWriter, settingsWatcher)};

    return runtime;
  } catch (error) {
    // Clean up resources from earlier steps on failure
    if (mcp?.mcpManager) await mcp.mcpManager.dispose().catch(() => {});
    await settingsWatcher.stop().catch(() => {});
    throw error;
  }
}

// ── Session Openers ──

export async function openCodaraSession(
  options: CodaraOptions & {sessionId: string; store: SessionStore},
): Promise<Codara> {
  const sessionState = await options.store.get(options.sessionId);
  if (sessionState) return reopenCodaraSession(options, sessionState);

  // Fallback: attempt transcript-based restore
  if (options.projectRoot || options.cwd) {
    const {restoreSession} = await import('@durability/session/restore');
    const {getTranscriptPath} = await import('@durability/session/storage');
    const projectRoot = resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});
    const userHome = options.userHome ?? process.env.HOME ?? '';
    const transcriptPath = getTranscriptPath({projectRoot, userHome, sessionId: options.sessionId});
    try {
      const restored = await restoreSession(transcriptPath);
      if (restored.entries.length > 0) {
        return assembleCodara({...options, sessionId: options.sessionId, restore: 'never'});
      }
    } catch { /* transcript not available */ }
  }

  throw new Error(`Session not found: ${options.sessionId}`);
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
    mcpManager?: McpManager;
    subagentRunStore?: SubagentRunStore;
    subagentRunManager?: SubagentRunManager;
    approvalStore?: ApprovalStore;
    channelRegistry?: ChannelRegistry;
    dynamicSections?: DynamicSectionRegistry;
    memoryWriter?: MemoryWriter;
    memoryReader?: MemoryReader;
    costTracker?: CostTracker;
  },
): Codara {
  const costTracker = preloadedSources?.costTracker ?? new CostTracker();
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;
  const alias = normalizeAlias(options.alias);
  const guidelinesSource = preloadedSources?.guidelinesSource ?? createCodaraGuidelinesSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const promptSource = preloadedSources?.promptSource ?? createCodaraPromptSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });

  const tools = createCodaraTools(options);
  const agentFactory = createDefaultAgentFactory();
  const middlewareFactory = createDefaultMiddlewareFactory();
  const session = createSession({
    ...(restoredState ? {state: restoredState} : {}),
    id: options.id, sessionId: options.sessionId, store: options.store,
    checkpointer: options.checkpointer, restore: options.restore,
    messages: options.messages, context: options.context, values: options.values,
    modelRef: alias, agentFactory, middlewareFactory,
    ...(options.model ? {model: options.model} : {}),
    ...(!options.model ? {modelCatalog: options.catalog ?? createCodaraModelCatalog({config: options.config})} : {}),
    guidelinesSource, promptSource,
    ...(skillsSource ? {skillsSource} : {}),
    ...(preloadedSources?.dynamicSections ? {dynamicSections: preloadedSources.dynamicSections} : {}),
    tools,
    ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
    middleware: [createCostMiddleware({tracker: costTracker}), ...createCodaraMiddlewares(options, preloadedSources?.channelRegistry)],
    ...(options.summary ? {summary: options.summary as false | Record<string, unknown>} : {}),
    ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
    ...(preloadedSources?.hookPipeline ? {lifecycle: preloadedSources.hookPipeline as SessionLifecycleHooks & AgentLifecycleHooks} : {}),
  });
  preloadedSources?.subagentRunStore?.recoverSession?.(session.getState().sessionId);

  // Extra properties for commands (/reload, /hooks, /mcp)
  const mcpManager = preloadedSources?.mcpManager;
  const commandAgent = {
    ...session,
    ...(preloadedSources?.hookRegistry ? {hookRegistry: preloadedSources.hookRegistry} : {}),
    ...(mcpManager ? {getMcpStatus: () => mcpManager.status()} : {}),
    getCostSnapshot: () => costTracker.getSnapshot(),
  };

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

  // Wire subagent events into runtime event stream
  if (preloadedSources?.subagentRunManager) {
    preloadedSources.subagentRunManager.setOnAgentEvent(
      (event) => { for (const listener of commandEventListeners) listener(event); },
      () => session.getState().sessionId,
    );
  }

  const channelRegistry = preloadedSources?.channelRegistry;

  const subagentRunManager = preloadedSources?.subagentRunManager;
  const reviewControl = createCodaraReviewControl({
    session,
    approvalStore: preloadedSources?.approvalStore,
    subagentReviewResumer: subagentRunManager,
  });
  const streamInteraction = createCodaraInteractionStream({
    session,
    reviewControl,
    subagentRunStore: preloadedSources?.subagentRunStore,
    subagentRunManager,
  });

  const dispose = async (): Promise<void> => {
    await subagentRunManager?.dispose();
    await session.dispose();
    if (mcpManager) await mcpManager.dispose();
    if (channelRegistry) await channelRegistry.disposeAll();
  };

  return {
    ...session, subscribeRuntimeEvents, listCommands: commands.listCommands, executeCommand,
    listSessions: async (opts?: import('@durability/session').SessionListOptions) => options.store ? options.store.list(opts) : [],
    getMcpStatus: () => mcpManager?.status() ?? [],
    getSubagentRunSummaries: () => getSubagentRunSummaries(preloadedSources?.subagentRunStore, session.getState().sessionId),
    getSubagentRunDetails: async (runIds?: readonly string[]) => getSubagentRunDetails({
      store: preloadedSources?.subagentRunStore,
      checkpointer: options.checkpointer,
      parentSessionId: session.getState().sessionId,
      runIds,
    }),
    listReviewItems: reviewControl.listReviewItems,
    getFocusedReview: reviewControl.getFocusedReview,
    focusReview: reviewControl.focusReview,
    streamInteraction,
    resumeReview: reviewControl.resumeReview,
    getChannelRegistry: () => channelRegistry,
    getMemoryWriter: () => preloadedSources?.memoryWriter,
    getCostSnapshot: () => costTracker.getSnapshot(),
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
