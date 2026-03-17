import {existsSync} from 'node:fs';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgentFileCheckpointer} from '@engine/checkpoint';
import {ensurePermissionSettingsFile} from '@engine/pipeline/permission';
import {createTaskFileStore} from '@capability/task';
import {ChatModelFactory, loadModelRoutingConfig, loadModelRoutingConfigFromPath, ModelRegistry, resolveCodaraPath, type ModelInfo, type ModelRoutingConfig} from '@infra/provider';
import {createCodaraGuidelinesSource, type GuidelinesSource} from '@infra/context/instructions/guidelines';
import {createCodaraPromptSource, type PromptSource} from '@infra/context/instructions/prompt';
import {createAutoMemoryRuntime, type AutoMemoryRuntime} from '@infra/context/memory/auto-memory';
import {createCodaraSkillsSource} from '@capability/skill';
import {createSkillCodaraCommands} from '@capability/command/skills';
import {createCodaraCommandRunner, type CodaraCommandResult} from '@capability/command';
import {
  createSession, FileSessionStore,
  type CodaraRuntimeEvent, type CodaraRuntimeEventListener,
  type SessionState, type SessionStore,
} from '@engine/session';
import {resolveWorkspaceRoot} from '@infra/config/workspace';
import {HookRegistryImpl, HookPipeline, createHookExecutor} from '@engine/hook';
import type {HookSource, HookRegistry, SessionLifecycleHooks, AgentLifecycleHooks} from '@engine/hook';
import {loadMcpConfig, createMcpManager, createMcpLangChainTools, type McpManager} from '@engine/mcp';
import type {TeamRegistry} from '@capability/team/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {createCodaraMiddlewares, createRuntimeDefaultMiddlewares, createCodaraTools, resolveCodaraSkills, resolveRuntimeLoggingOptions} from './middleware-chain';
import {assembleTeamSystem, getTeamSummaries, getTeamDetail} from './team-assembly';
import type {
  Codara, CodaraOptions, CodaraRuntimeOptions,
  CreateCodaraModelCatalogOptions, CreateCodaraChatModelOptions,
} from './types';

// Re-export all types from types.ts for backward compatibility
export type {
  Codara, CodaraOptions, CodaraRuntimeOptions, CodaraAutoMemoryOptions,
  CodaraSkillOptions, CodaraMiddlewareOptions,
  CreateCodaraModelCatalogOptions, CreateCodaraChatModelOptions,
  TeamQuerySummary, TeamQueryMember, TeamQueryJob, TeamQueryDetail,
} from './types';

// Re-export from middleware-chain (tests import from @codara/facade)
export {createCodaraMiddlewares, createCodaraTools, type CodaraToolsOptions} from './middleware-chain';

export const DEFAULT_CODARA_MODEL_ALIAS = 'default';

// ── Model Catalog ──

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

// ── Model Factory Functions ──

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

// ── Public Entry Points ──

export function createCodara(options: CodaraOptions = {}): Codara {
  return assembleCodara(options);
}

export async function createCodaraRuntime(options: CodaraRuntimeOptions = {}): Promise<Codara> {
  const codaraPath = resolveCodaraRuntimePath(options);
  const projectRoot = resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});

  // 1. Infrastructure
  const guidelinesSource = createCodaraGuidelinesSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const promptSource = createCodaraPromptSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const taskStore = options.taskStore ?? createTaskFileStore({
    rootDir: path.join(projectRoot, '.codara', 'tasks'),
  });
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
  const hookSources: HookSource[] = [{kind: 'project', path: path.join(codaraPath, 'hooks.json')}];
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
  const teamSystem = await assembleTeamSystem({options, codaraPath, projectRoot, catalog});
  for (const t of teamSystem.teamTools) runtimeTools.push(t);

  // 7. Middleware chain
  const runtimeMiddlewares = createRuntimeDefaultMiddlewares({
    options, runtimeTools, taskStore, logging, catalog, promptSource, guidelinesSource, hookPipeline,
  });

  // 8. Assemble facade
  return assembleCodara({
    ...options,
    tools: runtimeTools, middleware: runtimeMiddlewares, hil: false,
    autoMemory: options.autoMemory === false ? false
      : (typeof options.autoMemory === 'object' && options.autoMemory !== null ? options.autoMemory : {}),
    summary: options.summary === false ? false : (options.summary ?? {}),
    ...(logging === false ? {logging: false} : {logging}),
    ...(catalog ? {catalog} : {}),
    ...(options.store ? {} : {store: new FileSessionStore({basePath: path.join(codaraPath, 'sessions')})}),
    ...(options.checkpointer ? {} : {
      checkpointer: createAgentFileCheckpointer({rootDir: path.join(codaraPath, 'sessions')}),
    }),
    restore: options.restore ?? 'latest',
  }, undefined, {
    promptSource, guidelinesSource, hookPipeline, hookRegistry, mcpManager,
    teamRegistry: teamSystem.teamRegistry, teamRuntime: teamSystem.teamRuntime,
  });
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
    middleware: createCodaraMiddlewares(options),
    ...(options.summary ? {summary: options.summary} : {}),
    ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
    ...(preloadedSources?.hookPipeline ? {lifecycle: preloadedSources.hookPipeline as SessionLifecycleHooks & AgentLifecycleHooks} : {}),
  });

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

  const dispose = async (): Promise<void> => {
    await session.dispose();
    if (mcpManager) await mcpManager.dispose();
  };

  return {
    ...session, subscribeRuntimeEvents, listCommands: commands.listCommands, executeCommand,
    listSessions: async (opts?: import('@engine/session').SessionListOptions) => options.store ? options.store.list(opts) : [],
    getMcpStatus: () => mcpManager?.status() ?? [],
    getTeamSummaries: () => getTeamSummaries(preloadedSources?.teamRegistry),
    getTeamDetail: (teamId: string) => getTeamDetail(preloadedSources?.teamRegistry, teamId),
    dispose,
  };
}

// ── Private Helpers ──

function resolveCodaraAutoMemory(options: CodaraOptions): AutoMemoryRuntime | undefined {
  if (options.autoMemory === false) return undefined;
  const memOpts = typeof options.autoMemory === 'object' && options.autoMemory !== null ? options.autoMemory : {};
  return createAutoMemoryRuntime({
    cwd: memOpts.cwd ?? options.cwd, projectRoot: memOpts.projectRoot ?? options.projectRoot,
    userHome: memOpts.userHome ?? options.userHome, autoGlobal: memOpts.autoGlobal, rootDir: memOpts.rootDir,
  });
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
