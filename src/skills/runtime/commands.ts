import {readFile} from 'node:fs/promises';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {SkillMetadata, SkillStore, SkillsRuntimeData} from '@skills/contracts';
import {normalizeDiscoveredSkills} from '@skills/catalog/metadata';

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

export function createSkillTool(
  getRuntime: () => SkillsRuntimeData | undefined,
): StructuredToolInterface {
  return tool(
    async ({skill: skillName, args: skillArgs}) => {
      const runtime = getRuntime();
      if (!runtime) {
        return 'Skills system not initialized yet. Try again after the first model turn.';
      }

      const match = findSkill(runtime.discovered, skillName);
      if (!match) {
        const available = runtime.discovered.map((skill) => skill.name).join(', ');
        return `Skill "${skillName}" not found. Available skills: ${available || '(none)'}`;
      }

      let fullContent: string;
      try {
        fullContent = await readFile(match.path, 'utf8');
      } catch {
        return `Could not read skill file: ${match.path}`;
      }

      const parts = [`<command-name>${match.command?.name ?? match.name}</command-name>`, fullContent];
      if (skillArgs) {
        parts.push('', `User request: ${skillArgs}`);
      }
      return parts.join('\n');
    },
    {
      name: 'Skill',
      description: [
        'Execute a skill within the main conversation.',
        '',
        'When users ask you to perform tasks, check if any of the available skills match.',
        'Skills provide specialized capabilities and domain knowledge.',
        '',
        'When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"),',
        'they are referring to a skill. Use this tool to invoke it.',
        '',
        'How to invoke:',
        '- Use this tool with the skill name and optional arguments',
        '- Examples:',
        '  - skill: "commit" - invoke the commit skill',
        '  - skill: "review-pr", args: "123" - invoke with arguments',
        '',
        'Important:',
        '- Available skills are listed in system-reminder messages in the conversation',
        '- When a skill matches the user\'s request, this is a BLOCKING REQUIREMENT:',
        '  invoke the relevant Skill tool BEFORE generating any other response about the task',
        '- NEVER mention a skill without actually calling this tool',
        '- Do not invoke a skill that is already running',
      ].join('\n'),
      schema: z.object({
        skill: z.string().describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
        args: z.string().optional().describe('Optional arguments for the skill'),
      }),
    },
  );
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

function findSkill(discovered: SkillMetadata[], name: string): SkillMetadata | undefined {
  const lower = name.toLowerCase();
  const exact = discovered.find((skill) =>
    skill.name === lower
    || skill.command?.name === lower
    || skill.command?.aliases?.includes(lower),
  );
  if (exact) {
    return exact;
  }

  return discovered.find((skill) => {
    const colonIdx = skill.name.indexOf(':');
    return colonIdx >= 0 && skill.name.slice(colonIdx + 1) === lower;
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
