import type {AgentTurnContextPreparer} from '@core/agents';
import {formatSkillsList, formatSkillsLocations, SKILLS_SYSTEM_PROMPT} from '@core/skills/metadata';
import {readSkillsRuntimeData, type SkillsRuntimeData} from '@core/skills/subagents';
import type {GuidelinesSource} from '@core/sources/guidelines';
import type {SkillsSource} from '@core/sources/skills';

export interface SourceTurnContextOptions {
  guidelinesSource?: GuidelinesSource;
  skillsSource?: SkillsSource;
}

export function createSourceTurnContextPreparer(
  options: SourceTurnContextOptions,
): AgentTurnContextPreparer | undefined {
  if (!options.guidelinesSource && !options.skillsSource) {
    return undefined;
  }

  return async (context) => {
    if (options.guidelinesSource) {
      const content = await options.guidelinesSource.getContent();
      if (content) {
        context.systemMessage.push(content);
      }
    }

    if (!options.skillsSource) {
      return;
    }

    const shared = context.runtime.shared ?? (context.runtime.shared = {});
    const existingRuntime = readSkillsRuntimeData(shared);
    const runtime = existingRuntime ?? await options.skillsSource.getRuntime();

    if (!existingRuntime) {
      shared.skills = runtime;
    }

    context.systemMessage.push(createSkillsSystemPrompt(runtime));
  };
}

export function createSkillsSystemPrompt(
  runtime: Pick<SkillsRuntimeData, 'sources' | 'discovered'>,
): string {
  return SKILLS_SYSTEM_PROMPT
    .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
    .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources));
}
