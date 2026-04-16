/** Context sources initialization: guidelines, prompts, skills, dynamic sections. */
import path from 'node:path';
import {createCodaraGuidelinesSource, type GuidelinesSource, createCodaraPromptSource, type PromptSource} from '@context/sources';
import {type SkillsSource, createCodaraSkillsSource} from '@capability/skill';
import {buildBaseSystemMessage} from '@context/system-message';
import {DynamicSectionRegistry} from '@context/dynamic-sections';
import {createGitContextProvider} from '@context/git-context';
import {createMemoryContextProvider} from '@context/memory-context';
import {loadCodaraMd} from '@config/codara-md';
import {resolveCodaraSkills} from '../assembly/context';
import type {CodaraRuntimeOptions} from '../types';

export interface ContextSources {
  guidelinesSource: GuidelinesSource;
  promptSource: PromptSource;
  skillsSource?: SkillsSource;
  dynamicSections: DynamicSectionRegistry;
}

export async function initContextSources(
  options: Pick<CodaraRuntimeOptions, 'cwd' | 'projectRoot' | 'userHome' | 'skills'>,
  projectRoot: string,
  userHome: string,
): Promise<ContextSources> {
  const guidelinesSource = createCodaraGuidelinesSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const promptSource = createCodaraPromptSource({
    cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome,
  });
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;

  const dynamicSections = new DynamicSectionRegistry();
  dynamicSections.register('git', createGitContextProvider(projectRoot));
  const memoryDir = path.join(userHome, '.codara', 'memory');
  dynamicSections.register('memory', createMemoryContextProvider(memoryDir));
  dynamicSections.register('instructions', async () => {
    const result = await loadCodaraMd({projectRoot, userHome});
    if (result.instructions.length === 0) return undefined;
    return result.instructions.map(i => i.content).join('\n\n');
  });

  await buildBaseSystemMessage({promptSource, guidelinesSource, skillsSource, dynamicSections});

  return {guidelinesSource, promptSource, skillsSource, dynamicSections};
}
