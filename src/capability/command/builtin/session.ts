import type {CodaraCommandDefinition} from '@capability/command/runtime/types';
import {BUILTIN_SOURCE, formatContextWindow, formatUsage} from './formatters';

export const sessionCommand: CodaraCommandDefinition = {
  name: 'session',
  usage: '/session [list|switch <id>]',
  description: 'Manage sessions.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'host_action',
  },
  async execute({command, agent, environment}) {
    const subcommand = command.args[0]?.trim();

    // /session list — show session picker (same as /resume without args)
    if (subcommand === 'list') {
      return {
        ok: true,
        command: command.name,
        output: '',
        action: {
          type: 'show_session_picker',
        },
      };
    }

    // /session switch <id> — switch to another session
    if (subcommand === 'switch') {
      const targetId = command.args[1]?.trim();
      if (!targetId) {
        return {
          ok: false,
          command: command.name,
          output: 'Usage: /session switch <sessionId>',
        };
      }

      const session = agent.getState();
      if (session.sessionId === targetId) {
        return {
          ok: true,
          command: command.name,
          output: `Already using session ${targetId}.`,
          action: {
            type: 'resume_session',
            sessionId: targetId,
          },
        };
      }

      return {
        ok: true,
        command: command.name,
        output: `Switching to session ${targetId}.`,
        action: {
          type: 'resume_session',
          sessionId: targetId,
        },
      };
    }

    // /session (no args) — show current session info
    const session = agent.getState();
    const contextWindow = session.metadata?.contextWindow;
    const usage = session.metadata?.usage;

    return {
      ok: true,
      command: command.name,
      output: [
        'Session info:',
        `- id: ${session.sessionId}`,
        `- status: ${session.sessionStatus}`,
        `- model: ${environment.modelAlias ?? 'default'}`,
        `- messages: ${session.metadata?.messageCount ?? 0}`,
        `- last_activity: ${session.metadata?.lastActivity ?? 'n/a'}`,
        `- context: ${formatContextWindow(contextWindow)}`,
        `- usage: ${formatUsage(usage)}`,
      ].join('\n'),
    };
  },
};
