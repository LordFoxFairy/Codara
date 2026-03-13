import {existsSync} from 'node:fs';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentCheckpointer} from '@core/checkpoint';
import {createAgentFileCheckpointer} from '@core/checkpoint';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import type {SummarySettings} from '@core/middleware/summary';
import {
  createAskUserTool,
  createBudgetMiddleware,
  createDailySessionFileLogSink,
  createHILMiddleware,
  createInteractionMiddleware,
  createLoggingMiddleware,
} from '@core/middleware';
import {
  createPermissionMiddleware,
  ensurePermissionSettingsFile,
} from '@core/permissions';
import {ChatModelFactory, loadModelRoutingConfig, loadModelRoutingConfigFromPath, ModelRegistry, resolveCodaraPath, type ModelInfo, type ModelRoutingConfig} from '@core/provider';
import {
  createCodaraGuidelinesSource,
  type GuidelinesOptions,
} from '@core/instructions/guidelines';
import {
  createCodaraPromptSource,
  type PromptOptions,
} from '@core/instructions/prompt';
import {
  createCodaraSkillsSource,
  FileSystemSkillStore,
  type SkillStore,
} from '@core/skills';
import {createSkillCodaraCommands} from '@core/commands/skills';
import {createCodaraCommandRunner, type CodaraCommandResult, type CodaraCommandSpec} from '@core/commands';
import {createSession, FileSessionStore, type Session, type SessionState, type SessionStore} from '@core/sessions';
import {resolveWorkspaceRoot} from '@core/shared/workspace';
import {createBuiltinTools} from '@core/tools';

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
  guidelines?: boolean | GuidelinesOptions;
  prompt?: boolean | PromptOptions;
  skills?: false | CodaraSkillOptions;
  summary?: false | SummarySettings;
  hil?: false | HILMiddlewareOptions;
  logging?: false | LoggingMiddlewareOptions;
  sessionId?: string;
  restore?: 'latest' | 'never';
  store?: SessionStore;
  checkpointer?: AgentCheckpointer;
  handleToolErrors?: boolean;
  inputBudget?: import('@core/agents').AgentInputBudget;
  messages?: import('@core/agents').AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
}

export interface CodaraRuntimeOptions extends CodaraOptions {
  codaraPath?: string;
}

export type CreateCodaraModelCatalogOptions = Pick<CodaraOptions, 'config'>;

export type CreateCodaraChatModelOptions =
  Pick<CodaraOptions, 'alias' | 'config'>
  & {
    catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  };

export type CodaraToolsOptions = Pick<CodaraOptions, 'builtinTools' | 'cwd' | 'tools'>;

export type CodaraMiddlewareOptions = Pick<CodaraOptions, 'middleware' | 'hil' | 'logging'>;

export type Codara = Session & {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
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

export function createCodaraRuntime(options: CodaraRuntimeOptions = {}): Codara {
  const codaraPath = resolveCodaraRuntimePath(options);
  ensurePermissionSettingsFile({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  });
  const catalog = !options.model && !options.catalog && !options.config
    ? loadModelRoutingConfigFromPath(codaraPath).then((config) => createCodaraModelCatalog({config}))
    : options.catalog;
  const logging = resolveRuntimeLoggingOptions(options);
  const runtimeInteractionTools = options.hil === false ? [] : [createAskUserTool()];
  const runtimeInteractionMiddleware = options.hil === false ? [] : [createInteractionMiddleware()];
  const permissionMiddleware = options.hil === false ? [] : [createPermissionMiddleware({
    ...(typeof options.hil === 'object' && options.hil !== null ? options.hil : {}),
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
  })];

  return createCodara({
    ...options,
    tools: mergeRuntimeTools(options.tools, runtimeInteractionTools),
    middleware: [...(options.middleware ?? []), ...runtimeInteractionMiddleware, ...permissionMiddleware],
    hil: false,
    ...(logging === false ? {logging: false} : {logging}),
    ...(catalog ? {catalog} : {}),
    ...(options.store ? {} : {store: new FileSessionStore({basePath: path.join(codaraPath, 'sessions')})}),
    ...(options.checkpointer ? {} : {
      checkpointer: createAgentFileCheckpointer({rootDir: path.join(codaraPath, 'sessions')}),
    }),
    restore: options.restore ?? 'latest',
  });
}

function assembleCodara(options: CodaraOptions, restoredState?: SessionState): Codara {
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;
  const alias = normalizeAlias(options.alias);
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
    guidelinesSource: createCodaraGuidelinesSource({
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome: options.userHome,
      guidelines: options.guidelines,
    }),
    promptSource: createCodaraPromptSource({
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome: options.userHome,
      prompt: options.prompt,
    }),
    ...(skillsSource ? {skillsSource} : {}),
    tools: createCodaraTools(options),
    ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
    middleware: createCodaraMiddlewares(options),
    ...(options.summary ? {summary: options.summary} : {}),
    ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
  });

  const commands = createCodaraCommandRunner({
    agent: session,
    ...(skillsSource ? {getDynamicCommands: () => createSkillCodaraCommands(skillsSource)} : {}),
  });

  return {...session, listCommands: commands.listCommands, executeCommand: commands.executeCommand};
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
  for (const tool of createBuiltinTools({cwd: options.cwd})) {
    byName.set(tool.name, tool);
  }
  for (const tool of options.tools ?? []) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

export function createCodaraMiddlewares(options: CodaraMiddlewareOptions = {}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }
  middlewares.push(...(options.middleware ?? []));
  middlewares.push(createBudgetMiddleware());
  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }
  return middlewares;
}

function resolveCodaraSkills(
  options: Pick<CodaraOptions, 'skills' | 'cwd'>,
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
      ...((options.skills?.projectRoot || options.skills?.cwd || options.cwd)
        ? {
            projectRoot: resolveWorkspaceRoot({
              projectRoot: options.skills?.projectRoot,
              cwd: options.skills?.cwd ?? options.cwd,
            }),
          }
        : {}),
      ...((options.skills?.cwd || options.cwd) ? {cwd: options.skills?.cwd ?? options.cwd} : {}),
      ...(options.skills?.userHome ? {userHome: options.skills.userHome} : {}),
      ...(typeof options.skills?.cacheTtlMs === 'number' ? {cacheTtlMs: options.skills.cacheTtlMs} : {}),
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

function mergeRuntimeTools(
  callerTools: StructuredToolInterface[] | undefined,
  runtimeTools: StructuredToolInterface[],
): StructuredToolInterface[] | undefined {
  if (runtimeTools.length === 0) {
    return callerTools;
  }

  const byName = new Map<string, StructuredToolInterface>();
  for (const tool of callerTools ?? []) {
    byName.set(tool.name, tool);
  }
  for (const tool of runtimeTools) {
    if (!byName.has(tool.name)) {
      byName.set(tool.name, tool);
    }
  }

  return [...byName.values()];
}

function resolveCodaraRuntimePath(options: Pick<CodaraRuntimeOptions, 'codaraPath' | 'cwd' | 'projectRoot'>): string {
  if (options.codaraPath?.trim()) {
    return path.resolve(options.codaraPath.trim());
  }

  const workspaceRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const projectCodaraPath = path.join(workspaceRoot, '.codara');
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

  const workspaceRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const rootDir = path.join(workspaceRoot, '.codara', 'sessions');
  const provided = options.logging ?? {};

  return {
    ...provided,
    enabled: true,
    logger: provided.logger ?? createDailySessionFileLogSink({rootDir}),
  };
}
