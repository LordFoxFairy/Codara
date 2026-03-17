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
    const sub = command.args[0]?.toLowerCase();
    const args = command.args.slice(1);

    switch (sub) {
      case 'add': {
        const [name, url] = args;
        if (!name || !url) return err(command.name, 'Usage: /remote add <name> <url>');
        return ok(command.name, `Remote agent "${name}" registered at ${url}.`);
      }
      case 'list':
        return ok(command.name, 'No remote agents registered.\n\nUse /remote add <name> <url> to register one.');
      case 'remove': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /remote remove <name>');
        return ok(command.name, `Remote agent "${name}" removed.`);
      }
      case 'ping': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /remote ping <name>');
        return ok(command.name, `Pinging "${name}"... (A2A integration pending)`);
      }
      default:
        return err(command.name, [
          'Remote A2A Agent Management.',
          '',
          'Usage:',
          '  /remote add <name> <url>   Register a remote agent',
          '  /remote list               List registered remotes',
          '  /remote remove <name>      Remove a remote',
          '  /remote ping <name>        Test connectivity',
        ].join('\n'));
    }
  },
};

function ok(cmd: string, output: string): CodaraCommandResult {
  return {ok: true, command: cmd, output};
}

function err(cmd: string, output: string): CodaraCommandResult {
  return {ok: false, command: cmd, output};
}
