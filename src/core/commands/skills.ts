import {
  createSkillCommandInvocation,
  discoverSkillCommandsFromRuntime,
  type SkillCommandDefinition,
} from '@core/instructions/skills/commands';
import type {SkillsSource} from '@core/instructions/skills';
import type {CodaraCommandDefinition} from '@core/commands/types';
import {readLatestAssistantText} from '@core/shared/messages';

export async function createSkillCodaraCommands(
  source: SkillsSource,
): Promise<readonly CodaraCommandDefinition[]> {
  const commands = discoverSkillCommandsFromRuntime(await source.getRuntime());
  return commands.map(bindSkillCommand);
}

function bindSkillCommand(command: SkillCommandDefinition): CodaraCommandDefinition {
  return {
    name: command.name,
    description: command.description,
    usage: command.usage,
    source: {
      type: 'skill',
      skillName: command.skill.name,
      skillPath: command.skill.path,
    },
    ...(command.aliases?.length ? {aliases: command.aliases} : {}),
    async execute({command: parsed, agent}) {
      if (!parsed.argsText.trim()) {
        return {
          ok: false,
          command: parsed.name,
          output: [
            `/${command.name}`,
            command.description,
            `Usage: ${command.usage}`,
            `Skill: ${command.skill.name}`,
            `Path: ${command.skill.path}`,
          ].join('\n'),
        };
      }

      const invocation = createSkillCommandInvocation(command, parsed.argsText);
      const result = await agent.invoke(invocation.prompt);
      return {
        ok: true,
        command: parsed.name,
        output: readLatestAssistantText(result.state.messages) ?? '(no output)',
        state: result.state,
      };
    },
  };
}
