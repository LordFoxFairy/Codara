import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import {
  createSkillCommandInvocation,
  discoverSkillCommandsFromRuntime,
  type SkillCommandDefinition,
} from '@core/knowledge/skills/commands';
import type {SkillsSource} from '@core/knowledge/skills';
import type {CodaraCommandDefinition} from '@core/commands/types';

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
    async execute({command: parsed, host}) {
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
      const result = await host.invokePrompt(invocation.prompt);
      return {
        ok: true,
        command: parsed.name,
        output: readLatestAssistantText(result.state.messages),
        state: result.state,
      };
    },
  };
}

function readLatestAssistantText(messages: readonly BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !AIMessage.isInstance(message)) {
      continue;
    }

    const content = renderMessageContent(message.content);
    if (content) {
      return content;
    }
  }

  return '(no output)';
}

function renderMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .join('');
}
