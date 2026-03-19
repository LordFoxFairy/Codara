import type {AgentContextPreparer} from '@core/agent';
import {FileSystemSkillStore, type SkillStore} from '@capability/skill';
import {
  applyPreparedInstructionContext,
  buildBaseSystemMessage,
} from '@context/session-bundle/base-system-message';
import {
  createAutoMemoryRuntime,
  type AutoMemoryRuntime,
} from '@context/memory/auto-memory';
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
}): AgentContextPreparer | undefined {
  if (!sources.promptSource && !sources.guidelinesSource) {
    return undefined;
  }

  return async (context) => {
    const next = await buildBaseSystemMessage(sources.promptSource, sources.guidelinesSource);
    applyPreparedInstructionContext(context, next);
  };
}

export function resolveCodaraAutoMemory(options: CodaraOptions): AutoMemoryRuntime | undefined {
  if (options.autoMemory === false) {
    return undefined;
  }
  const memoryOptions =
    typeof options.autoMemory === 'object' && options.autoMemory !== null
      ? options.autoMemory
      : {};
  return createAutoMemoryRuntime({
    cwd: memoryOptions.cwd ?? options.cwd,
    projectRoot: memoryOptions.projectRoot ?? options.projectRoot,
    userHome: memoryOptions.userHome ?? options.userHome,
    autoGlobal: memoryOptions.autoGlobal,
    rootDir: memoryOptions.rootDir,
  });
}
