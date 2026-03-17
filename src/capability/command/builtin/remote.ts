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
  async execute({command, agent}) {
    const sub = command.args[0]?.toLowerCase();
    const args = command.args.slice(1);

    const pool = agent.remotePool;
    if (!pool) {
      return err(command.name, 'Remote agent system not initialized. RemotePool not available.');
    }

    switch (sub) {
      case 'add': {
        const [name, url] = args;
        if (!name || !url) return err(command.name, 'Usage: /remote add <name> <url>');
        try {
          await pool.addRemote({name, url});
          return ok(command.name, `Remote agent "${name}" registered at ${url}.`);
        } catch (e) {
          return err(command.name, `Failed to add remote: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'list': {
        const remotes = pool.listRemotes();
        if (remotes.length === 0) {
          return ok(command.name, 'No remote agents registered.\n\nUse /remote add <name> <url> to register one.');
        }
        const header = 'Name              URL';
        const separator = '─'.repeat(60);
        const rows = remotes.map(r => `${r.name.padEnd(18)}${r.url}`);
        return ok(command.name, [header, separator, ...rows].join('\n'));
      }
      case 'remove': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /remote remove <name>');
        try {
          await pool.removeRemote(name);
          return ok(command.name, `Remote agent "${name}" removed.`);
        } catch (e) {
          return err(command.name, `Failed to remove remote: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'ping': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /remote ping <name>');
        const remote = pool.getRemote(name);
        if (!remote) return err(command.name, `Remote "${name}" not found.`);
        try {
          const cardUrl = remote.url.replace(/\/$/, '') + '/.well-known/agent-card.json';
          const res = await fetch(cardUrl, {signal: AbortSignal.timeout(5_000)});
          if (res.ok) {
            const card = await res.json();
            return ok(command.name, `Ping "${name}" at ${remote.url}: OK\nAgent: ${card.name ?? 'unknown'}\nProtocol: ${card.protocolVersion ?? 'unknown'}`);
          }
          return err(command.name, `Ping "${name}": HTTP ${res.status}`);
        } catch (e) {
          return err(command.name, `Ping "${name}" failed: ${e instanceof Error ? e.message : String(e)}`);
        }
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
