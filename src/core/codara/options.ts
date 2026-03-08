import type {CreateAgentOptions} from '@core/agents';
import type {AgentCheckpoint, AgentCheckpointer} from '@core/checkpoint/state';
import type {CreateCodaraAgentOptions} from '@core/codara/types';

/** 合并 Codara 顶层入口与单次 session 覆盖项。 */
export function mergeCodaraOptions(
  base: CreateCodaraAgentOptions,
  override: CreateCodaraAgentOptions,
  checkpointer: AgentCheckpointer
): CreateCodaraAgentOptions {
  return {
    ...base,
    ...override,
    tools: override.tools ?? base.tools,
    builtinTools: override.builtinTools ?? base.builtinTools,
    cwd: override.cwd ?? base.cwd,
    model: override.model ?? base.model,
    alias: override.alias ?? base.alias,
    catalog: override.catalog ?? base.catalog,
    modelResolver: override.modelResolver ?? base.modelResolver,
    config: override.config ?? base.config,
    threadId: override.threadId ?? base.threadId,
    checkpointer: override.checkpointer ?? base.checkpointer ?? checkpointer,
    checkpoint: override.checkpoint ?? base.checkpoint,
    middleware: override.middleware ?? override.middlewares ?? base.middleware ?? base.middlewares,
    messages: override.messages ?? base.messages,
    context: override.context ?? base.context,
    state: override.state ?? base.state,
    handleToolErrors: override.handleToolErrors ?? base.handleToolErrors,
    skills: mergeSkillsOptions(base.skills, override.skills),
    hil: override.hil ?? base.hil,
    logging: override.logging ?? base.logging,
  };
}

/** 构建传给 createAgent(...) 的初始状态。 */
export function buildCodaraAgentState(options: CreateCodaraAgentOptions): CreateAgentOptions['state'] | undefined {
  if (!options.state && !options.messages && !options.context) {
    return undefined;
  }

  return {
    ...(options.state ?? {}),
    ...(options.messages ? {messages: options.messages} : {}),
    ...(options.context ? {context: options.context} : {}),
  };
}

/** 在需要时读取 thread 最新 checkpoint。 */
export async function resolveCodaraCheckpoint(
  options: {restore?: 'latest' | 'never'; threadId?: string; checkpointer?: AgentCheckpointer}
): Promise<AgentCheckpoint | undefined> {
  if (options.restore !== 'latest' || !options.threadId || !options.checkpointer) {
    return undefined;
  }

  return options.checkpointer.getLatest(options.threadId);
}

function mergeSkillsOptions(
  base: CreateCodaraAgentOptions['skills'],
  override: CreateCodaraAgentOptions['skills']
): CreateCodaraAgentOptions['skills'] {
  if (override === false) {
    return false;
  }
  if (override !== undefined) {
    if (base === false) {
      return override;
    }
    return {
      ...(base ?? {}),
      ...override,
    };
  }
  return base;
}
