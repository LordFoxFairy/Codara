import {
  createCodaraGuidelinesSource,
  createCodaraSkillsSource,
  createSourceTurnContextPreparer,
  type SkillsSource,
} from '@core/sources';
import type {CreateSessionOptions} from '@core/sessions/types';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS} from '@core/product/models';
import {
  createCodaraMiddlewares,
  resolveCodaraSkills,
} from '@core/product/stack';
import {createCodaraTools} from '@core/product/tools';
import type {CodaraOptions} from '@core/product/types';

export interface CodaraSessionAssembly {
  sessionOptions: Pick<
    CreateSessionOptions,
    'modelRef'
    | 'model'
    | 'modelCatalog'
    | 'guidelinesSource'
    | 'skillsSource'
    | 'tools'
    | 'handleToolErrors'
    | 'middleware'
    | 'prepareTurnContext'
    | 'inputBudget'
  >;
  skillsSource?: SkillsSource;
}

export function createCodaraSessionAssembly(options: CodaraOptions = {}): CodaraSessionAssembly {
  const guidelinesSource = createCodaraGuidelinesSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
    guidelines: options.guidelines,
  });

  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;

  const alias = options.alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
  const model = options.model ?? (options.modelResolver ? options.modelResolver() : undefined);
  const modelCatalog = model
    ? undefined
    : options.catalog ?? createCodaraModelCatalog({
      config: options.config,
    });
  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options);
  const prepareTurnContext = createSourceTurnContextPreparer({
    guidelinesSource,
    skillsSource,
  });

  return {
    sessionOptions: {
      modelRef: alias,
      ...(model ? {model} : {}),
      ...(modelCatalog ? {modelCatalog} : {}),
      guidelinesSource,
      ...(skillsSource ? {skillsSource} : {}),
      tools,
      ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
      middleware,
      ...(prepareTurnContext ? {prepareTurnContext} : {}),
      ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
    },
    ...(skillsSource ? {skillsSource} : {}),
  };
}
