import {
  createSkillCommandInvocation,
  discoverSkillCommandsFromRuntime,
  type SkillCommandDefinition,
} from '@capability/skill/runtime/commands';
import type {SkillsSource} from '@capability/skill';
import type {CodaraCommandDefinition} from '@capability/command/runtime/types';
import {readLatestAssistantText} from '@shared/messages';
import {
  deriveSkillCommandRequirements,
  runSkillCommandPreflight,
  type SkillCommandRequirements,
  type SkillCommandPreflightResult,
} from '@capability/command/runtime/skill-requirements';

export async function createSkillCodaraCommands(
  source: SkillsSource,
): Promise<readonly CodaraCommandDefinition[]> {
  const commands = discoverSkillCommandsFromRuntime(await source.getRuntime());
  return commands.map(bindSkillCommand);
}

function bindSkillCommand(command: SkillCommandDefinition): CodaraCommandDefinition {
  const requirements = deriveSkillCommandRequirements(command.skill.allowedTools);

  return {
    name: command.name,
    description: command.description,
    usage: command.usage,
    source: {
      type: 'skill',
      skillName: command.skill.name,
      skillPath: command.skill.path,
    },
    help: {
      executionMode: 'agent_workflow',
      ...(requirements.allowedTools.length > 0 ? {allowedTools: requirements.allowedTools} : {}),
      ...(requirements.requiredShellCommands.length > 0
        ? {requiredShellCommands: requirements.requiredShellCommands}
        : {}),
    },
    ...(command.aliases?.length ? {aliases: command.aliases} : {}),
    async execute({command: parsed, agent}) {
      const preflight = runSkillCommandPreflight(requirements, agent.getAvailableToolNames());
      if (!preflight.ok) {
        return {
          ok: false,
          command: parsed.name,
          output: formatSkillCommandPreflightFailure(command, requirements, preflight, agent.getAvailableToolNames()),
        };
      }

      const invocation = await createSkillCommandInvocation(command, parsed.argsText);
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

function formatSkillCommandPreflightFailure(
  command: SkillCommandDefinition,
  requirements: SkillCommandRequirements,
  preflight: SkillCommandPreflightResult,
  availableToolNames: readonly string[],
): string {
  return [
    `Cannot run /${command.name} in this runtime.`,
    'Reason: the current runtime does not satisfy this skill command\'s requirements.',
    ...(preflight.missingRuntimeTools.length > 0
      ? [`Missing runtime tools: ${preflight.missingRuntimeTools.join(', ')}`]
      : []),
    ...(preflight.missingShellCommands.length > 0
      ? [`Missing shell commands in PATH: ${preflight.missingShellCommands.join(', ')}`]
      : []),
    ...(requirements.allowedTools.length > 0
      ? [`Skill allowed-tools: ${requirements.allowedTools.join(', ')}`]
      : []),
    ...(availableToolNames.length > 0
      ? [`Available tools: ${availableToolNames.join(', ')}`]
      : []),
    'Suggested fixes:',
    ...(preflight.missingRuntimeTools.length > 0
      ? [`- Use createCodaraRuntime(...) or enable the missing tools in your Codara runtime: ${preflight.missingRuntimeTools.join(', ')}`]
      : []),
    ...(preflight.missingShellCommands.length > 0
      ? [`- Install the missing shell commands and ensure they are available in PATH: ${preflight.missingShellCommands.join(', ')}`]
      : []),
  ].join('\n');
}
