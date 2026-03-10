import {createCompactCommand} from '@core/codara/commands/compact';
import {createHelpCommand} from '@core/codara/commands/help';
import {createMemoryCommand} from '@core/codara/commands/memory';
import {createReloadCommand} from '@core/codara/commands/reload';
import {createResumeCommand} from '@core/codara/commands/resume';
import type {
  CodaraCommandDefinition,
  CodaraCommandHost,
  CodaraCommandResult,
  ParsedCodaraCommand,
  CodaraCommandSpec,
} from '@core/codara/commands/types';

export interface CodaraCommandRunner {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
}

export interface CreateCodaraCommandRunnerOptions {
  host: CodaraCommandHost;
  getDynamicCommands?: () => Promise<readonly CodaraCommandDefinition[]>;
}

export function createCodaraCommandRunner(options: CreateCodaraCommandRunnerOptions): CodaraCommandRunner {
  const builtIns = createBuiltInCodaraCommands();

  return {
    async listCommands() {
      const registry = await loadRegistry(builtIns, options.getDynamicCommands);
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

      const registry = await loadRegistry(builtIns, options.getDynamicCommands);
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
        host: options.host,
      });
    },
  };
}

function createBuiltInCodaraCommands(): CodaraCommandDefinition[] {
  return [
    createHelpCommand(),
    createMemoryCommand(),
    createResumeCommand(),
    createCompactCommand(),
    createReloadCommand(),
  ];
}

async function loadRegistry(
  builtIns: readonly CodaraCommandDefinition[],
  getDynamicCommands?: () => Promise<readonly CodaraCommandDefinition[]>,
): Promise<readonly CodaraCommandDefinition[]> {
  const dynamicCommands = getDynamicCommands ? await getDynamicCommands() : [];
  return mergeCommandRegistry(builtIns, dynamicCommands);
}

function mergeCommandRegistry(
  builtIns: readonly CodaraCommandDefinition[],
  dynamicCommands: readonly CodaraCommandDefinition[],
): readonly CodaraCommandDefinition[] {
  const merged = [...builtIns];
  const reserved = new Set<string>();

  for (const command of builtIns) {
    reserved.add(command.name);
    for (const alias of command.aliases ?? []) {
      reserved.add(alias);
    }
  }

  for (const command of dynamicCommands) {
    if (reserved.has(command.name)) {
      continue;
    }
    if ((command.aliases ?? []).some((alias) => reserved.has(alias))) {
      continue;
    }
    merged.push(command);
    reserved.add(command.name);
    for (const alias of command.aliases ?? []) {
      reserved.add(alias);
    }
  }

  return merged;
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
    source: command.source,
    ...(command.aliases?.length ? {aliases: [...command.aliases]} : {}),
  };
}

function parseCodaraCommand(input: string): ParsedCodaraCommand | undefined {
  const raw = input.trim();
  if (!raw.startsWith('/')) {
    return undefined;
  }

  const body = raw.slice(1).trim();
  if (!body) {
    return undefined;
  }

  const parts = body.split(/\s+/).filter(Boolean);
  const [name, ...args] = parts;
  if (!name) {
    return undefined;
  }

  return {
    raw,
    name: name.toLowerCase(),
    args,
    argsText: args.join(' '),
  };
}
