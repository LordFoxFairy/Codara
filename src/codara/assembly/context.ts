import type {AgentContextPreparer} from '@core/agent';
import type {BaseMiddleware} from '@core/pipeline/types';
import {FileSystemSkillStore, type SkillStore} from '@capability/skill';
import {
  buildBaseSystemMessage,
  createBaseSystemMessageLoader,
  mergePreparedInstructionContext,
  type BaseSystemMessageLoader,
  type BuildBaseSystemMessageOptions,
} from '@context/session-bundle/base-system-message';
import {createPathInstructionsMiddleware} from '@core/middleware/path-instructions';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {GuidelinesSource} from '@context/instructions/guidelines';
import type {PromptSource} from '@context/prompts/prompt-source';
import type {CodaraOptions} from '../types';

export function resolveCodaraSkills(
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
      ...((options.skills?.userHome || options.userHome)
        ? {userHome: options.skills?.userHome ?? options.userHome}
        : {}),
      ...(typeof options.skills?.cacheTtlMs === 'number' ? {cacheTtlMs: options.skills.cacheTtlMs} : {}),
      ...(options.skills?.claudeSkillsCompat ? {claudeSkillsCompat: true} : {}),
    }),
    subagentRoots: options.skills?.subagentRoots ?? [],
  };
}

export function createInstructionContextPreparer(sources: {
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
  skillsSource?: BuildBaseSystemMessageOptions['skillsSource'];
}): AgentContextPreparer | undefined {
  if (
    !sources.promptSource
    && !sources.guidelinesSource
    && !sources.skillsSource
  ) {
    return undefined;
  }

  return async (context) => {
    const next = await buildBaseSystemMessage({
      promptSource: sources.promptSource,
      guidelinesSource: sources.guidelinesSource,
      skillsSource: sources.skillsSource,
    });
    mergePreparedInstructionContext(context, next);
  };
}

export interface InstructionContextRuntime {
  prepareContext?: AgentContextPreparer;
  loadBaseSystemMessage?: BaseSystemMessageLoader;
  middlewares?: BaseMiddleware[];
}

export function createInstructionContextRuntime(sources: {
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
  skillsSource?: BuildBaseSystemMessageOptions['skillsSource'];
}): InstructionContextRuntime {
  const loadBaseSystemMessage = createBaseSystemMessageLoader({
    promptSource: sources.promptSource,
    guidelinesSource: sources.guidelinesSource,
    skillsSource: sources.skillsSource,
  });

  const middlewares: BaseMiddleware[] = [];
  if (sources.promptSource || sources.guidelinesSource) {
    middlewares.push(createPathInstructionsMiddleware({
      promptSource: sources.promptSource,
      guidelinesSource: sources.guidelinesSource,
    }));
  }

  return {
    loadBaseSystemMessage,
    prepareContext: createInstructionContextPreparer(sources),
    ...(middlewares.length > 0 ? {middlewares} : {}),
  };
}
