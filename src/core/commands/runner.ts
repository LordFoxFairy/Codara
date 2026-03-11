import type {
  CodaraCommandDefinition,
  CodaraCommandAgent,
  CodaraCommandResult,
  CodaraCommandSpec,
  ParsedCodaraCommand,
} from '@core/commands/types';

export interface CodaraCommandRunner {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
}

export interface CreateCodaraCommandRunnerOptions {
  agent: CodaraCommandAgent;
  getDynamicCommands?: () => Promise<readonly CodaraCommandDefinition[]>;
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
        return errorResult('', 'Not a slash command.');
      }

      const registry = await loadRegistry(builtIns, options.getDynamicCommands);
      const definition = resolveCommand(registry, command.name);
      if (!definition) {
        return errorResult(
          command.name,
          `Unknown command: /${command.name}\nRun /help to see available commands.`,
        );
      }

      return definition.execute({command, registry, agent: options.agent});
    },
  };
}

function createBuiltInCommands(): readonly CodaraCommandDefinition[] {
  return [
    {
      name: 'help',
      usage: '/help [command]',
      description: 'Show available Codara slash commands.',
      source: {type: 'builtin'},
      async execute({command, registry}) {
        const targetName = command.args[0]?.toLowerCase();
        if (!targetName) {
          const builtIns = registry.filter((item) => item.source.type === 'builtin');
          const skillCommands = registry.filter((item) => item.source.type === 'skill');

          return successResult(command.name, [
            'Available commands:',
            ...builtIns.map(formatCommandSummary),
            ...(skillCommands.length > 0
              ? ['', 'Skill commands:', ...skillCommands.map(formatCommandSummary)]
              : []),
          ].join('\n'));
        }

        const target = resolveCommand(registry, targetName);
        if (!target) {
          return errorResult(command.name, `Unknown command: /${targetName}`);
        }

        return successResult(command.name, [
          `/${target.name}`,
          target.description,
          `Usage: ${target.usage}`,
          `Source: ${formatCommandSource(target)}`,
          ...(target.aliases?.length ? [`Aliases: ${target.aliases.map((alias) => `/${alias}`).join(', ')}`] : []),
        ].join('\n'));
      },
    },
    {
      name: 'memory',
      usage: '/memory [show|project|global]',
      description: 'Inspect or prepare the session AGENTS.md source files for manual editing.',
      source: {type: 'builtin'},
      async execute({command, agent}) {
        const subcommand = (command.args[0] ?? 'show').toLowerCase();
        if (subcommand === 'show') {
          const overview = await agent.inspectAgentsFiles();
          return successResult(command.name, [
            'AGENTS source stack:',
            ...overview.stack.map((entry) => `- ${entry.scope}: ${formatLoadedState(entry.path, overview.loadedPaths)}`),
            '',
            'This view only shows AGENTS.md source files.',
            'It does not show checkpoint history, session metadata, or durable agent context.',
            '',
            'Edit targets:',
            `- global: ${overview.globalPath}`,
            `- project: ${overview.projectPath}`,
            '',
            'Choose a target with /memory project or /memory global.',
            'After saving changes, run /reload so the current session picks them up.',
          ].join('\n'));
        }

        if (subcommand === 'project' || subcommand === 'global') {
          const filePath = await agent.ensureAgentsFileTarget(subcommand);
          return {
            ...successResult(command.name, [
              `Edit this ${subcommand} AGENTS.md file:`,
              filePath,
              '',
              'After saving changes, run /reload so the current session picks them up.',
              ...(subcommand === 'project'
                ? ['Use /memory global if you want to edit the global AGENTS.md instead.']
                : ['Use /memory project if you want to edit the project AGENTS.md instead.']),
            ].join('\n')),
            action: {
              type: 'open_file' as const,
              path: filePath,
            },
          };
        }

        return errorResult(command.name, 'Usage: /memory [show|project|global]');
      },
    },
    {
      name: 'resume',
      usage: '/resume [approve|reject] [feedback]',
      description: 'Resume the current paused HIL action in the active conversation.',
      aliases: ['continue'],
      source: {type: 'builtin'},
      async execute({command, agent}) {
        const state = await agent.hydrate();
        if (state.status !== 'paused' || !state.pendingPause) {
          return errorResult(command.name, 'No paused action is waiting for review in the current session.');
        }

        const decision = normalizeResumeDecision(command.args[0]);
        const feedback = decision ? command.args.slice(1).join(' ').trim() : command.args.join(' ').trim();
        const result = await agent.resumePause(
          {decision},
          feedback ? {input: feedback} : undefined,
        );

        return {
          ...successResult(
            command.name,
            decision === 'reject'
              ? 'Paused action rejected and the conversation has resumed.'
              : 'Paused action approved and the conversation has resumed.',
          ),
          state: result.state,
        };
      },
    },
    {
      name: 'compact',
      usage: '/compact [instructions] | /compact checkpoints [keepLast]',
      description: 'Compact the current conversation context, or prune stored checkpoint history.',
      source: {type: 'builtin'},
      async execute({command, agent}) {
        const target = command.args[0]?.toLowerCase();
        if (target === 'checkpoints') {
          const keepLast = normalizeKeepLast(command.args[1]);
          await agent.compactCheckpoints(typeof keepLast === 'number' ? {keepLast} : undefined);
          return successResult(
            command.name,
            typeof keepLast === 'number'
              ? `Checkpoint history compacted. Kept the latest ${keepLast} snapshots.`
              : 'Checkpoint history compacted with the default retention policy.',
          );
        }

        return errorResult(
          command.name,
          'Conversation compaction is not implemented yet. The /compact hook position is reserved, but the algorithm has been removed for redesign.',
        );
      },
    },
    {
      name: 'reload',
      usage: '/reload',
      description: 'Invalidate session-scoped AGENTS.md caches and reload sources on the next model call.',
      source: {type: 'builtin'},
      async execute({command, agent}) {
        await agent.reloadSources();
        return successResult(
          command.name,
          'Session source caches cleared. AGENTS.md will be reloaded on the next model call.',
        );
      },
    },
  ];
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

function normalizeKeepLast(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeResumeDecision(value: string | undefined): 'approve' | 'reject' {
  const normalized = value?.toLowerCase();
  return normalized === 'reject' || normalized === 'deny' ? 'reject' : 'approve';
}

function formatLoadedState(filePath: string, loadedPaths: readonly string[]): string {
  return loadedPaths.includes(filePath)
    ? `${filePath} (loaded)`
    : `${filePath} (not currently loaded)`;
}

function formatCommandSummary(command: CodaraCommandSpec): string {
  const suffix = command.source.type === 'skill' ? ` [skill: ${command.source.skillName}]` : '';
  return `- ${command.usage} : ${command.description}${suffix}`;
}

function formatCommandSource(command: CodaraCommandSpec): string {
  return command.source.type === 'builtin'
    ? 'built-in Codara agent command'
    : `skill "${command.source.skillName}" (${command.source.skillPath})`;
}

function successResult(command: string, output: string): CodaraCommandResult {
  return {ok: true, command, output};
}

function errorResult(command: string, output: string): CodaraCommandResult {
  return {ok: false, command, output};
}
