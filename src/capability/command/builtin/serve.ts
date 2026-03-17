import type {CodaraCommandDefinition, CodaraCommandResult} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const serveCommand: CodaraCommandDefinition = {
  name: 'serve',
  usage: '/serve [--a2a] [--port <port>]',
  description: 'Start Codara as an A2A server, exposing it as a remote agent.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command}) {
    const args = command.args;
    const portIdx = args.indexOf('--port');
    const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 9000;

    if (isNaN(port) || port < 1 || port > 65535) {
      return err(command.name, 'Invalid port number. Use a value between 1 and 65535.');
    }

    return ok(command.name, [
      `A2A Server starting on port ${port}...`,
      `Agent Card: http://localhost:${port}/.well-known/agent-card.json`,
      `JSON-RPC: http://localhost:${port}/`,
      '',
      '(Full server integration pending — this is a command scaffold)',
    ].join('\n'));
  },
};

function ok(cmd: string, output: string): CodaraCommandResult {
  return {ok: true, command: cmd, output};
}

function err(cmd: string, output: string): CodaraCommandResult {
  return {ok: false, command: cmd, output};
}
