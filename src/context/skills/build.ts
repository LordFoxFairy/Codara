import {
  formatSkillsList,
  formatSkillsLocations,
  SKILLS_SYSTEM_PROMPT,
} from '@capability/skill/catalog/metadata';
import type {SkillStore, SkillsRuntimeBundle, SkillsRuntimeData} from '@capability/skill/contracts';
import {loadSkillsRuntimeData} from '@capability/skill/runtime/runtime';

export function createSkillsRuntimeBundle(runtime: SkillsRuntimeData): SkillsRuntimeBundle {
  return {
    systemMessage: SKILLS_SYSTEM_PROMPT
      .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
      .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources)),
    runtimeShared: {
      skills: runtime,
    },
  };
}

export async function loadSkillsRuntimeBundle(
  store: SkillStore,
  subagentRoots: string[] = [],
): Promise<SkillsRuntimeBundle> {
  return createSkillsRuntimeBundle(await loadSkillsRuntimeData(store, subagentRoots));
}
