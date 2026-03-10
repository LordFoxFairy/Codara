import {FileSystemSkillStore, type SkillStore} from '@core/skills';
import type {CodaraMiddlewareOptions, CodaraSkillOptions} from '@core/codara/types';
import {resolveWorkspaceRoot} from '@core/workspace';

export interface CodaraResolvedSkills {
  store: SkillStore;
  agentRoots: string[];
}

export function resolveCodaraSkills(
  options: Pick<CodaraMiddlewareOptions, 'skills' | 'cwd'>,
): CodaraResolvedSkills | undefined {
  if (options.skills === false) {
    return undefined;
  }

  if (options.skills?.store) {
    return {
      store: options.skills.store,
      agentRoots: options.skills.agentRoots ?? [],
    };
  }

  return {
    store: new FileSystemSkillStore(buildSkillStoreOptions(options.skills, options.cwd)),
    agentRoots: options.skills?.agentRoots ?? [],
  };
}

function buildSkillStoreOptions(skills: CodaraSkillOptions | undefined, cwd: string | undefined) {
  const skillOptions = skills;
  return {
    ...(skillOptions?.sources ? {sources: skillOptions.sources} : {}),
    ...((skillOptions?.projectRoot || skillOptions?.cwd || cwd)
      ? {
          projectRoot: resolveWorkspaceRoot({
            projectRoot: skillOptions?.projectRoot,
            cwd: skillOptions?.cwd ?? cwd,
          }),
        }
      : {}),
    ...((skillOptions?.cwd || cwd) ? {cwd: skillOptions?.cwd ?? cwd} : {}),
    ...(skillOptions?.userHome ? {userHome: skillOptions.userHome} : {}),
    ...(typeof skillOptions?.cacheTtlMs === 'number' ? {cacheTtlMs: skillOptions.cacheTtlMs} : {}),
  };
}
