import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import type {CodaraCommandDefinition} from '@core/codara/commands/types';
import type {SkillMetadata, SkillStore} from '@core/skills';
import {normalizeDiscoveredSkills} from '@core/skills';

export async function createSkillCodaraCommands(
  store: SkillStore,
): Promise<readonly CodaraCommandDefinition[]> {
  const skills = normalizeDiscoveredSkills(await store.discover());
  return skills
    .filter((skill) => skill.command?.name)
    .map((skill) => createSkillCommand(skill));
}

function createSkillCommand(skill: SkillMetadata): CodaraCommandDefinition {
  const command = skill.command!;

  return {
    name: command.name,
    description: command.description ?? skill.description,
    usage: command.usage ?? `/${command.name} <request>`,
    source: {
      type: 'skill',
      skillName: skill.name,
      skillPath: skill.path,
    },
    ...(command.aliases?.length ? {aliases: command.aliases} : {}),
    async execute({command: parsed, host}) {
      if (!parsed.argsText.trim()) {
        return {
          ok: false,
          command: parsed.name,
          output: [
            `/${command.name}`,
            command.description ?? skill.description,
            `Usage: ${command.usage ?? `/${command.name} <request>`}`,
            `Skill: ${skill.name}`,
            `Path: ${skill.path}`,
          ].join('\n'),
        };
      }

      const prompt = buildSkillCommandPrompt(skill, parsed.argsText);
      const result = await host.invokePrompt(prompt);
      const output = readLatestAssistantText(result.state.messages);

      return {
        ok: true,
        command: parsed.name,
        output,
        state: result.state,
      };
    },
  };
}

function buildSkillCommandPrompt(skill: SkillMetadata, request: string): string {
  return [
    `Use the skill "${skill.name}" to handle this request.`,
    `Read the skill instructions from: ${skill.path}`,
    '',
    'User request:',
    request,
  ].join('\n');
}

function readLatestAssistantText(messages: readonly BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
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
