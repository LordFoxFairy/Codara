import type {CodaraCommandDefinition, CodaraCommandResult} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const remoteCommand: CodaraCommandDefinition = {
  name: 'remote',
  usage: '/remote <add|list|remove|ping>',
  description: 'Manage remote A2A agent connections.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command}) {
    return {ok: false, command: command.name, output: 'Remote A2A agent management is not yet available. This feature is planned for a future release.'} as CodaraCommandResult;
  },
};
