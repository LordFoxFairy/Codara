import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {CodaraAgentOptions} from '@core/codara/types';

export function mergeCodaraAgentOptions(
  base: CodaraAgentOptions,
  override: CodaraAgentOptions,
  defaultCheckpointer: AgentCheckpointer
): CodaraAgentOptions {
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
    checkpointer: override.checkpointer ?? base.checkpointer ?? defaultCheckpointer,
    checkpoint: override.checkpoint ?? base.checkpoint,
    middleware: override.middleware ?? override.middlewares ?? base.middleware ?? base.middlewares,
    messages: override.messages ?? base.messages,
    context: override.context ?? base.context,
    handleToolErrors: override.handleToolErrors ?? base.handleToolErrors,
    skills: mergeCodaraSkillsOptions(base.skills, override.skills),
    guidelines: override.guidelines ?? base.guidelines,
    memory: override.memory ?? base.memory,
    summary: override.summary ?? base.summary,
    hil: override.hil ?? base.hil,
    logging: override.logging ?? base.logging,
  };
}

function mergeCodaraSkillsOptions(
  base: CodaraAgentOptions['skills'],
  override: CodaraAgentOptions['skills']
): CodaraAgentOptions['skills'] {
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
