import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentInputBudget} from '@core/agents';
import type {BaseMiddleware} from '@core/middleware';
import type {AgentsSource} from '@core/sessions/agents';
import {createCodaraAgentsSource} from '@core/sessions/agents';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS, type CodaraModelCatalog} from '@core/codara/models';
import {createCodaraTools} from '@core/codara/tools';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import type {CodaraOptions} from '@core/codara/types';
import {deriveAgentInputBudget} from '@core/agents/input-budget';
import {resolveCodaraSkills, type CodaraResolvedSkills} from '@core/codara/skills';

export interface ResolvedCodaraRuntime {
  alias: string;
  model: BaseChatModel;
  modelCatalog: CodaraModelCatalog;
  agentsSource?: AgentsSource;
  skills?: CodaraResolvedSkills;
  tools: StructuredToolInterface[];
  middleware: BaseMiddleware[];
  inputBudget?: AgentInputBudget;
}

export interface CodaraRuntimePlan {
  alias: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  modelCatalog: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  agentsSource?: AgentsSource;
  skills?: CodaraResolvedSkills;
  tools: StructuredToolInterface[];
  middleware: BaseMiddleware[];
}

/**
 * 解析 Codara 产品层的默认运行时装配。
 * 这是 createCodara(...)、task/subagent 包装等高层入口共享的单一来源。
 */
export async function resolveCodaraRuntime(options: CodaraOptions = {}): Promise<ResolvedCodaraRuntime> {
  const plan = createCodaraRuntimePlan(options);
  const modelCatalog = await Promise.resolve(plan.modelCatalog);
  const model = plan.model
    ? await Promise.resolve(plan.model)
    : await modelCatalog.create(plan.alias);
  const inputBudget = options.inputBudget ?? (
    options.model || options.modelResolver
      ? undefined
      : deriveAgentInputBudget(modelCatalog.getInfo(plan.alias))
  );

  return {
    alias: plan.alias,
    model,
    modelCatalog,
    agentsSource: plan.agentsSource,
    skills: plan.skills,
    tools: plan.tools,
    middleware: plan.middleware,
    inputBudget,
  };
}

export function createCodaraRuntimePlan(options: CodaraOptions = {}): CodaraRuntimePlan {
  const agentsSource = createCodaraAgentsSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
    guidelines: options.guidelines,
  });

  const modelCatalog = options.catalog ?? createCodaraModelCatalog({
    config: options.config,
  });
  const skills = resolveCodaraSkills(options);

  const alias = options.alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
  const model = options.model ?? (options.modelResolver ? options.modelResolver() : undefined);
  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options, agentsSource, skills);

  return {
    alias,
    model,
    modelCatalog,
    agentsSource,
    skills,
    tools,
    middleware,
  };
}
