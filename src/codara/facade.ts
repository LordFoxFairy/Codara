/**
 * Codara facade -- the single public entry point for creating runtime instances.
 *
 * Provides three tiers of construction:
 *  - `createCodara()`        -- lightweight, no I/O, uses caller-provided deps
 *  - `createCodaraRuntime()` -- full runtime with settings, hooks, MCP, transcript
 *  - `openCodaraSession()`   -- restores an existing persisted session
 *
 * All three ultimately delegate to `assembleCodara()`, which wires Session,
 * Commands, Review, InteractionStream, SubagentRuns and CostTracker into the
 * unified `Codara` handle returned to consumers.
 */

import {existsSync} from 'node:fs';
import path from 'node:path';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgentFileCheckpointer} from '@state/checkpoint';
import {createApprovalFileStore, type ApprovalStore} from '@state/approval-store';
import {ensurePermissionSettingsFile} from '@core/middleware/permission';
import {createSubagentRunFileStore, createSubagentRunManager, type SubagentRunStore, type SubagentRunManager} from '@tasks/subagent';
import type {SessionListOptions} from '@state/session';
import {createTaskFileStore, createTaskRegistry} from '@tasks';
import type {TaskRegistry} from '@tasks/task-registry';
import {loadModelRoutingConfigFromPath, resolveCodaraPath} from '@models';
import {createCodaraGuidelinesSource, type GuidelinesSource, createCodaraPromptSource, type PromptSource} from '@context/sources';
import {createCodaraSkillsSource} from '@skills';
import {createSkillCodaraCommands} from '@commands/skill-commands';
import {createCodaraCommandRunner, type CodaraCommandResult} from '@commands';
import {
  createSession, FileSessionStore,
  type Session, type SessionState, type SessionStore,
} from '@state/session';
import type {CodaraRuntimeEvent, CodaraRuntimeEventListener} from '@events';
import {CostTracker, type CostSnapshot} from '@cost';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {HookRegistry, SessionLifecycleHooks, AgentLifecycleHooks} from '@hooks';
import {HookPipeline} from '@hooks';
import type {McpManager} from '@mcp';
import type {ChannelRegistry} from '@channels';
import type {DynamicSectionRegistry} from '@context/dynamic-sections';
import {MemoryWriter} from '@memory/writer';
import {MemoryReader} from '@memory/reader';
import {initSettings} from './runtime/init-settings';
import {initContextSources} from './runtime/init-context';
import {initHooks} from './runtime/init-hooks';
import {backgroundProcesses} from '@tools/builtin/bash';
import {initMcp} from './runtime/init-mcp';
import {wireTranscript, wrapDispose} from './runtime/init-transcript';
import {createCostMiddleware} from '@core/middleware/cost';
import {createCodaraMiddlewares, createRuntimeDefaultMiddlewares, resolveRuntimeLoggingOptions,} from './assembly/middleware';
import {getSubagentRunDetails} from './assembly/subagent-run-details';
import {getSubagentRunSummaries} from './assembly/subagent-runs';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS, normalizeCodaraAlias,} from './assembly/runtime';
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

/** Lightweight Codara instance -- no I/O, caller supplies all dependencies. */
export function createCodara(options: CodaraOptions = {}): Codara {
  return assembleCodara(options);
}

/**
 * Full runtime Codara with auto-discovered settings, hooks, MCP and transcript.
 *
 * Performs async I/O: reads config files, starts MCP servers, wires file watchers.
 * Call `dispose()` on the returned handle to release all resources.
 */
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
  const taskRegistry = createTaskRegistry();
  backgroundProcesses.taskRegistry = taskRegistry;
  const subagentRunManager = createSubagentRunManager({runStore: subagentRunStore, approvalStore, taskRegistry});
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

/** Reopen a persisted session by ID, falling back to transcript-based restore. */
export async function openCodaraSession(
  options: CodaraOptions & {sessionId: string; store: SessionStore},
): Promise<Codara> {
  const sessionState = await options.store.get(options.sessionId);
  if (sessionState) return reopenCodaraSession(options, sessionState);

  // Fallback: attempt transcript-based restore
  if (options.projectRoot || options.cwd) {
    const {restoreSession} = await import('@state/session/restore');
    const {getTranscriptPath} = await import('@state/session/storage');
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

/** Open the most recently active session from the store. */
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

/**
 * Wire all Codara subsystems (Session, Commands, Review, InteractionStream)
 * into the unified `Codara` handle.
 *
 * Called by both `createCodara` (minimal) and `createCodaraRuntime` (full).
 * The optional `preloadedSources` bypass redundant I/O when the caller already
 * holds references to hooks/MCP/stores created during runtime bootstrap.
 */
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
  const alias = normalizeCodaraAlias(options.alias);
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

  const mcpManager = preloadedSources?.mcpManager;
  const channelRegistry = preloadedSources?.channelRegistry;
  const subagentRunManager = preloadedSources?.subagentRunManager;

  // Wire commands + event relay
  const {subscribeRuntimeEvents, executeCommand, listCommands, eventListeners} = wireCommandExecution({
    session, costTracker, skillsSource, alias, options,
    hookRegistry: preloadedSources?.hookRegistry, mcpManager,
  });

  // Wire subagent events
  if (subagentRunManager) {
    subagentRunManager.setOnAgentEvent(
      (event) => { for (const listener of eventListeners) listener(event); },
      () => session.getState().sessionId,
    );
  }

  // Wire review + interaction stream
  const reviewControl = createCodaraReviewControl({
    session, approvalStore: preloadedSources?.approvalStore, subagentReviewResumer: subagentRunManager,
  });
  const streamInteraction = createCodaraInteractionStream({
    session, reviewControl, subagentRunStore: preloadedSources?.subagentRunStore, subagentRunManager,
  });

  const dispose = async (): Promise<void> => {
    await subagentRunManager?.dispose();
    await session.dispose();
    if (mcpManager) await mcpManager.dispose();
    if (channelRegistry) await channelRegistry.disposeAll();
  };

  return {
    ...session, subscribeRuntimeEvents, listCommands, executeCommand,
    listSessions: async (opts?: SessionListOptions) => options.store ? options.store.list(opts) : [],
    getMcpStatus: () => mcpManager?.status() ?? [],
    getSubagentRunSummaries: () => getSubagentRunSummaries(preloadedSources?.subagentRunStore, session.getState().sessionId),
    getSubagentRunDetails: async (runIds?: readonly string[]) => getSubagentRunDetails({
      store: preloadedSources?.subagentRunStore, checkpointer: options.checkpointer,
      parentSessionId: session.getState().sessionId, runIds,
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

/** Hydrate an already-loaded session state into a live Codara instance. */
async function reopenCodaraSession(options: CodaraOptions, state: SessionState): Promise<Codara> {
  const codara = assembleCodara({...options, sessionId: state.sessionId, restore: 'latest'}, state);
  await codara.hydrate();
  return codara;
}

// ── Command Execution Wiring ──

function wireCommandExecution(input: {
  session: Session;
  costTracker: CostTracker;
  skillsSource?: ReturnType<typeof createCodaraSkillsSource>;
  alias: string;
  options: CodaraOptions;
  hookRegistry?: HookRegistry;
  mcpManager?: McpManager;
}) {
  const {session, costTracker, skillsSource, alias, options, hookRegistry, mcpManager} = input;
  const commandAgent = {
    ...session,
    ...(hookRegistry ? {hookRegistry} : {}),
    ...(mcpManager ? {getMcpStatus: () => mcpManager.status()} : {}),
    getCostSnapshot: () => costTracker.getSnapshot(),
  };
  const commands = createCodaraCommandRunner({
    agent: commandAgent,
    environment: {cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome, modelAlias: alias},
    ...(skillsSource ? {getDynamicCommands: () => createSkillCodaraCommands(skillsSource)} : {}),
  });

  const eventListeners = new Set<CodaraRuntimeEventListener>();
  const subscribeRuntimeEvents = (listener: CodaraRuntimeEventListener) => {
    const unsub = session.subscribeRuntimeEvents(listener);
    eventListeners.add(listener);
    return () => { unsub(); eventListeners.delete(listener); };
  };
  const emitEvent = (input: Omit<CodaraRuntimeEvent, 'sessionId' | 'timestamp'>) => {
    const event: CodaraRuntimeEvent = {...input, sessionId: session.getState().sessionId, timestamp: new Date().toISOString()};
    for (const listener of eventListeners) listener(event);
  };
  const executeCommand = async (raw: string): Promise<CodaraCommandResult> => {
    const id = `command:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    emitEvent({id, kind: 'command', phase: 'start', status: 'running', label: `Running ${raw.trim()}`});
    const result = await commands.executeCommand(raw);
    emitEvent({
      id: `command:end:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind: 'command', phase: 'end', status: result.ok ? 'done' : 'error',
      label: result.ok ? `Completed ${raw.trim()}` : `Failed ${raw.trim()}`,
      detail: result.output.trim() || undefined, parentId: id,
    });
    return result;
  };

  return {subscribeRuntimeEvents, executeCommand, listCommands: commands.listCommands, eventListeners};
}

/** Resolve the `.codara` config directory: explicit path > project-local > global. */
function resolveCodaraRuntimePath(options: Pick<CodaraRuntimeOptions, 'codaraPath' | 'cwd' | 'projectRoot'>): string {
  if (options.codaraPath?.trim()) return path.resolve(options.codaraPath.trim());
  const projectRoot = resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});
  const projectCodaraPath = path.join(projectRoot, '.codara');
  if (existsSync(path.join(projectCodaraPath, 'config.json'))) return projectCodaraPath;
  return path.resolve(resolveCodaraPath());
}
