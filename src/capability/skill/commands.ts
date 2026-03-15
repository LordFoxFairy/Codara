import {readFile} from 'node:fs/promises';
import type {SkillsRuntimeData} from '@capability/skill/runtime';
import type {SkillMetadata, SkillStore} from '@capability/skill/types';
import {normalizeDiscoveredSkills} from '@capability/skill/metadata';

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

export async function createSkillCommandInvocation(
  command: SkillCommandDefinition,
  request: string,
): Promise<SkillCommandInvocation> {
  let fullContent: string;
  try {
    fullContent = await readFile(command.skill.path, 'utf8');
  } catch {
    fullContent = `(Could not read skill file: ${command.skill.path})`;
  }

  return {
    commandName: command.name,
    skillName: command.skill.name,
    skillPath: command.skill.path,
    request,
    prompt: [
      `<command-name>${command.name}</command-name>`,
      fullContent,
      '',
      ...(request ? [`User request: ${request}`] : []),
    ].filter(Boolean).join('\n'),
  };
}

function isUserInvocable(skill: SkillMetadata): boolean {
  const flag = skill.frontmatter?.['user-invocable'] ?? skill.extensions?.['user-invocable'];
  if (flag === false || flag === 'false') return false;
  return true;
}

function toSkillCommandDefinition(skill: SkillMetadata): SkillCommandDefinition | undefined {
  // Skip non-user-invocable skills
  if (!isUserInvocable(skill)) {
    return undefined;
  }

  // Use explicit command-name if available, otherwise fall back to skill name
  const commandName = skill.command?.name ?? skill.name;

  return {
    name: commandName,
    description: skill.command?.description ?? skill.description,
    usage: skill.command?.usage ?? `/${commandName} [args]`,
    ...(skill.command?.aliases?.length ? {aliases: skill.command.aliases} : {}),
    skill,
  };
}
