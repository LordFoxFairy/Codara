import type {SkillsRuntimeData} from '@core/skills/runtime';
import type {SkillMetadata, SkillStore} from '@core/skills/types';
import {normalizeDiscoveredSkills} from '@core/skills/metadata';

export interface SkillCommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  skill: SkillMetadata;
}

export interface SkillCommandInvocation {
  commandName: string;
  skillName: string;
  skillPath: string;
  request: string;
  prompt: string;
}

export async function discoverSkillCommands(
  store: SkillStore,
): Promise<readonly SkillCommandDefinition[]> {
  return discoverSkillCommandsFromMetadata(normalizeDiscoveredSkills(await store.discover()));
}

export function discoverSkillCommandsFromRuntime(
  runtime: Pick<SkillsRuntimeData, 'discovered'>,
): readonly SkillCommandDefinition[] {
  return discoverSkillCommandsFromMetadata(runtime.discovered);
}

function discoverSkillCommandsFromMetadata(
  skills: readonly SkillMetadata[],
): readonly SkillCommandDefinition[] {
  return skills.flatMap((skill) => {
    const definition = toSkillCommandDefinition(skill);
    return definition ? [definition] : [];
  });
}

export function createSkillCommandInvocation(
  command: SkillCommandDefinition,
  request: string,
): SkillCommandInvocation {
  return {
    commandName: command.name,
    skillName: command.skill.name,
    skillPath: command.skill.path,
    request,
    prompt: [
      `Use the skill "${command.skill.name}" to handle this request.`,
      `Read the skill instructions from: ${command.skill.path}`,
      '',
      'User request:',
      request,
    ].join('\n'),
  };
}

function toSkillCommandDefinition(skill: SkillMetadata): SkillCommandDefinition | undefined {
  if (!skill.command?.name) {
    return undefined;
  }

  return {
    name: skill.command.name,
    description: skill.command.description ?? skill.description,
    usage: skill.command.usage ?? `/${skill.command.name} <request>`,
    ...(skill.command.aliases?.length ? {aliases: skill.command.aliases} : {}),
    skill,
  };
}
