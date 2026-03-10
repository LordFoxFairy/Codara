import {readSummaryRecord} from '@core/middleware/summary';
import type {
  CodaraCommandDefinition,
  CodaraCommandResult,
  CodaraCommandSpec,
} from '@core/codara/commands/types';

export function createBuiltInCodaraCommands(): CodaraCommandDefinition[] {
  return [
    {
      name: 'help',
      usage: '/help [command]',
      description: 'Show built-in Codara slash commands.',
      async execute({command, registry}) {
        const targetName = command.args[0]?.toLowerCase();
        if (targetName) {
          const target = findCommand(registry, targetName);
          if (!target) {
            return errorResult(command.name, `Unknown command: /${targetName}`);
          }

          return {
            ok: true,
            command: command.name,
            output: [
              `/${target.name}`,
              target.description,
              `Usage: ${target.usage}`,
              ...(target.aliases?.length ? [`Aliases: ${target.aliases.map((alias) => `/${alias}`).join(', ')}`] : []),
            ].join('\n'),
          };
        }

        return {
          ok: true,
          command: command.name,
          output: [
            'Available commands:',
            ...registry.map(formatCommandSummary),
          ].join('\n'),
        };
      },
    },
    {
      name: 'resume',
      usage: '/resume [approve|reject] [feedback]',
      description: 'Resume the current paused HIL action in the active conversation.',
      aliases: ['continue'],
      async execute({command, host}) {
        const state = host.getAgentState();
        if (state.status !== 'paused' || !state.pendingPause) {
          return errorResult(command.name, 'No paused action is waiting for review in the current session.');
        }

        const decision = normalizeResumeDecision(command.args[0]);
        const feedback = decision ? command.args.slice(1).join(' ').trim() : command.args.join(' ').trim();
        const nextState = await host.resumePause({
          decision,
          ...(feedback ? {feedback} : {}),
        });

        return {
          ok: true,
          command: command.name,
          output: decision === 'reject'
            ? 'Paused action rejected and the conversation has resumed.'
            : 'Paused action approved and the conversation has resumed.',
          state: nextState,
        };
      },
    },
    {
      name: 'compact',
      usage: '/compact',
      description: 'Compact the current conversation context using the configured summary lifecycle.',
      async execute({command, host}) {
        const before = await host.compactConversation();
        const summary = readSummaryRecord(before.messages);

        if (!summary) {
          return {
            ok: true,
            command: command.name,
            output: 'No summary compaction was applied to the current conversation.',
            state: before,
          };
        }

        return {
          ok: true,
          command: command.name,
          output: `Conversation compacted. Summary now covers ${summary.summarizedMessages} earlier messages.`,
          state: before,
        };
      },
    },
    {
      name: 'reload',
      usage: '/reload',
      description: 'Invalidate session-scoped AGENTS.md caches and reload sources on the next model call.',
      async execute({command, host}) {
        host.reloadSources();
        return {
          ok: true,
          command: command.name,
          output: 'Session source caches cleared. AGENTS.md will be reloaded on the next model call.',
        };
      },
    },
  ];
}

function findCommand(
  registry: readonly CodaraCommandDefinition[],
  name: string,
): CodaraCommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return registry.find((command) =>
    command.name === normalized || command.aliases?.some((alias) => alias.toLowerCase() === normalized),
  );
}

function formatCommandSummary(command: CodaraCommandSpec): string {
  return `- ${command.usage} : ${command.description}`;
}

function errorResult(command: string, output: string): CodaraCommandResult {
  return {
    ok: false,
    command,
    output,
  };
}

function normalizeResumeDecision(value: string | undefined): 'approve' | 'reject' {
  if (!value) {
    return 'approve';
  }

  const normalized = value.toLowerCase();
  return normalized === 'reject' || normalized === 'deny'
    ? 'reject'
    : 'approve';
}
