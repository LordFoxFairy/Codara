/**
 * Context assembly -- resolves skill stores, instruction context preparers,
 * and the instruction-context runtime (system message loader + path-instructions middleware).
 */

import type {AgentContextPreparer} from '@core/agent';
import type {BaseMiddleware} from '@core/pipeline/types';
import {FileSystemSkillStore, type SkillStore} from '@capability/skill';
import {
  buildBaseSystemMessage,
  createBaseSystemMessageLoader,
  mergePreparedInstructionContext,
  type BaseSystemMessageLoader,
  type BuildBaseSystemMessageOptions,
} from '@context/system-message';
import {createPathInstructionsMiddleware} from '@core/middleware/path-instructions';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {GuidelinesSource, PromptSource} from '@context/sources';
import {type ConditionalRule} from '@context/rules';
import type {CodaraOptions} from '../types';

/** Resolve skill store + subagent roots from options, defaulting to FileSystemSkillStore. */
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

/** Build an AgentContextPreparer that merges prompt/guidelines/skills into system context. */
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

/** Bundle of instruction-related runtime resources for child agent bootstrapping. */
export interface InstructionContextRuntime {
  prepareContext?: AgentContextPreparer;
  loadBaseSystemMessage?: BaseSystemMessageLoader;
  middlewares?: BaseMiddleware[];
}

/** Assemble the full instruction context runtime (loader + optional path-instructions middleware). */
export function createInstructionContextRuntime(sources: {
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
  skillsSource?: BuildBaseSystemMessageOptions['skillsSource'];
  conditionalRules?: ConditionalRule[];
}): InstructionContextRuntime {
  const loadBaseSystemMessage = createBaseSystemMessageLoader({
    promptSource: sources.promptSource,
    guidelinesSource: sources.guidelinesSource,
    skillsSource: sources.skillsSource,
  });

  const middlewares: BaseMiddleware[] = [];
  if (sources.promptSource || sources.guidelinesSource || (sources.conditionalRules && sources.conditionalRules.length > 0)) {
    middlewares.push(createPathInstructionsMiddleware({
      promptSource: sources.promptSource,
      guidelinesSource: sources.guidelinesSource,
      conditionalRules: sources.conditionalRules,
    }));
  }

  return {
    loadBaseSystemMessage,
    prepareContext: createInstructionContextPreparer(sources),
    ...(middlewares.length > 0 ? {middlewares} : {}),
  };
}
