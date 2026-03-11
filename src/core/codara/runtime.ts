import type {StructuredToolInterface} from '@langchain/core/tools';
import {createCodaraAgentsSource} from '@core/sessions/agents';
import type {CreateSessionOptions} from '@core/sessions/types';
import type {SkillsSource} from '@core/sessions/skills';
import {createCodaraSkillsSource} from '@core/sessions/skills';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS} from '@core/codara/models';
import {
  createCodaraMiddlewares,
  resolveCodaraSkills,
} from '@core/codara/middleware';
import type {CodaraOptions, CodaraToolsOptions} from '@core/codara/types';
import {createBuiltinTools} from '@core/tools';

export interface CodaraSessionAssembly {
  sessionOptions: Pick<
    CreateSessionOptions,
    'modelRef'
    | 'model'
    | 'modelCatalog'
    | 'agentsSource'
    | 'skillsSource'
    | 'tools'
    | 'handleToolErrors'
    | 'middleware'
    | 'inputBudget'
  >;
  skillsSource?: SkillsSource;
}

export function createCodaraSessionAssembly(options: CodaraOptions = {}): CodaraSessionAssembly {
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
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;

  const alias = options.alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
  const model = options.model ?? (options.modelResolver ? options.modelResolver() : undefined);
  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options, agentsSource, skillsSource, skills);

  return {
    sessionOptions: {
      modelRef: alias,
      ...(model ? {model} : {}),
      modelCatalog,
      agentsSource,
      ...(skillsSource ? {skillsSource} : {}),
      tools,
      ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
      middleware,
      ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
    },
    ...(skillsSource ? {skillsSource} : {}),
  };
}

export function createCodaraTools(options: CodaraToolsOptions = {}): StructuredToolInterface[] {
  const extraTools = options.tools ?? [];
  if (options.builtinTools === false) {
    return [...extraTools];
  }

  const builtinTools = createBuiltinTools({cwd: options.cwd});
  const byName = new Map<string, StructuredToolInterface>();

  for (const tool of builtinTools) {
    byName.set(tool.name, tool);
  }

  for (const tool of extraTools) {
    byName.set(tool.name, tool);
  }

  return Array.from(byName.values());
}
