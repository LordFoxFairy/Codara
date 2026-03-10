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
  const skills = normalizeDiscoveredSkills(await store.discover());

  return skills.flatMap((skill) => {
    if (!skill.command?.name) {
      return [];
    }

    return [{
      name: skill.command.name,
      description: skill.command.description ?? skill.description,
      usage: skill.command.usage ?? `/${skill.command.name} <request>`,
      ...(skill.command.aliases?.length ? {aliases: skill.command.aliases} : {}),
      skill,
    }];
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
