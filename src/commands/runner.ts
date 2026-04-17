import type {
  CodaraCommandAgent,
  CodaraCommandDefinition,
  CodaraCommandEnvironment,
  CodaraCommandResult,
  CodaraCommandSpec,
  ParsedCodaraCommand,
} from '@commands/types';
import {createBuiltInCommands} from '@commands/builtin';

export interface CodaraCommandRunner {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
}

export interface CreateCodaraCommandRunnerOptions {
  agent: CodaraCommandAgent;
  getDynamicCommands?: () => Promise<readonly CodaraCommandDefinition[]>;
  environment?: CodaraCommandEnvironment;
}

export function createCodaraCommandRunner(options: CreateCodaraCommandRunnerOptions): CodaraCommandRunner {
  const builtIns = createBuiltInCommands();

  return {
    async listCommands() {
      return (await loadRegistry(builtIns, options.getDynamicCommands)).map(toSpec);
    },

    async executeCommand(input: string) {
      const command = parseCommand(input);
      if (!command) {
        return {ok: false, command: '', output: 'Not a slash command.'};
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
        agent: options.agent,
        environment: options.environment ?? {},
      });
    },
  };
}

async function loadRegistry(
  builtIns: readonly CodaraCommandDefinition[],
  getDynamicCommands?: () => Promise<readonly CodaraCommandDefinition[]>,
): Promise<readonly CodaraCommandDefinition[]> {
  const dynamicCommands = getDynamicCommands ? await getDynamicCommands() : [];
  const reserved = new Set<string>();
  const registry = [...builtIns];

  for (const command of builtIns) {
    reserved.add(command.name);
    for (const alias of command.aliases ?? []) {
      reserved.add(alias);
    }
  }

  for (const command of dynamicCommands) {
    if (reserved.has(command.name) || (command.aliases ?? []).some((alias) => reserved.has(alias))) {
      continue;
    }

    registry.push(command);
    reserved.add(command.name);
    for (const alias of command.aliases ?? []) {
      reserved.add(alias);
    }
  }

  return registry;
}

function resolveCommand(
  registry: readonly CodaraCommandDefinition[],
  name: string,
): CodaraCommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return registry.find((command) =>
    command.name === normalized || command.aliases?.some((alias) => alias.toLowerCase() === normalized),
  );
}

function toSpec(command: CodaraCommandDefinition): CodaraCommandSpec {
  return {
    name: command.name,
    usage: command.usage,
    description: command.description,
    source: command.source,
    ...(command.help ? {help: command.help} : {}),
    ...(command.aliases?.length ? {aliases: [...command.aliases]} : {}),
  };
}

function parseCommand(input: string): ParsedCodaraCommand | undefined {
  const raw = input.trim();
  if (!raw.startsWith('/')) {
    return undefined;
  }

  const body = raw.slice(1).trim();
  if (!body) {
    return undefined;
  }

  const [name, ...args] = body.split(/\s+/).filter(Boolean);
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
