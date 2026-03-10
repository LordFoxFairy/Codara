import {createBuiltInCodaraCommands} from '@core/codara/commands/builtins';
import {parseCodaraCommand} from '@core/codara/commands/parser';
import type {
  CodaraCommandDefinition,
  CodaraCommandHost,
  CodaraCommandResult,
  CodaraCommandSpec,
} from '@core/codara/commands/types';

export interface CodaraCommandRunner {
  listCommands(): readonly CodaraCommandSpec[];
  executeCommand(input: string): Promise<CodaraCommandResult>;
}

export function createCodaraCommandRunner(host: CodaraCommandHost): CodaraCommandRunner {
  const registry = createBuiltInCodaraCommands();

  return {
    listCommands() {
      return registry.map(toSpec);
    },

    async executeCommand(input: string): Promise<CodaraCommandResult> {
      const command = parseCodaraCommand(input);
      if (!command) {
        return {
          ok: false,
          command: '',
          output: 'Not a slash command.',
        };
      }

      const definition = resolveCommand(registry, command.name);
      if (!definition) {
        return {
          ok: false,
          command: command.name,
          output: `Unknown command: /${command.name}\nRun /help to see available commands.`,
        };
      }

      return definition.execute({
        command,
        registry,
        host,
      });
    },
  };
}

function resolveCommand(
  registry: readonly CodaraCommandDefinition[],
  name: string,
): CodaraCommandDefinition | undefined {
  return registry.find((command) =>
    command.name === name || command.aliases?.includes(name),
  );
}

function toSpec(command: CodaraCommandDefinition): CodaraCommandSpec {
  return {
    name: command.name,
    usage: command.usage,
    description: command.description,
    ...(command.aliases?.length ? {aliases: [...command.aliases]} : {}),
  };
}
