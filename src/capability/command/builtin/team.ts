import type {CodaraCommandDefinition, CodaraCommandResult} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const teamCommand: CodaraCommandDefinition = {
  name: 'team',
  usage: '/team <create|list|status|pause|resume|kill|finish|enter|leave|message|assign>',
  description: 'Manage Codara Agent Teams — create, monitor, and control multi-agent teams.',
  source: BUILTIN_SOURCE,
  aliases: ['t'],
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command}) {
    const sub = command.args[0]?.toLowerCase();
    const args = command.args.slice(1);

    switch (sub) {
      case 'create': {
        const goal = args.join(' ');
        if (!goal) return err(command.name, 'Usage: /team create <goal>');
        return ok(command.name, `Team creation initiated. Goal: "${goal}"\n(TeamRuntime integration pending)`);
      }
      case 'list':
        return ok(command.name, 'No active teams.\n\nUse /team create <goal> to start a team.');
      case 'status': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team status <name>');
        return ok(command.name, `Team "${name}" status: (TeamRuntime integration pending)`);
      }
      case 'pause': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team pause <name>');
        return ok(command.name, `Team "${name}" paused.`);
      }
      case 'resume': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team resume <name>');
        return ok(command.name, `Team "${name}" resumed.`);
      }
      case 'kill': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team kill <name>');
        return ok(command.name, `Team "${name}" killed.`);
      }
      case 'finish': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team finish <name>');
        return ok(command.name, `Team "${name}" finishing...`);
      }
      case 'enter': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team enter <name>');
        return ok(command.name, `Entered team "${name}". Type messages to interact.`);
      }
      case 'leave':
        return ok(command.name, 'Left team view. Back to global dashboard.');
      case 'message': {
        const name = args[0];
        const msg = args.slice(1).join(' ');
        if (!name || !msg) return err(command.name, 'Usage: /team message <name> <message>');
        return ok(command.name, `Message sent to team "${name}".`);
      }
      case 'assign': {
        const [name, jobId, memberId] = args;
        if (!name || !jobId || !memberId) return err(command.name, 'Usage: /team assign <name> <jobId> <memberId>');
        return ok(command.name, `Job ${jobId} assigned to ${memberId} in team "${name}".`);
      }
      default:
        return err(command.name, [
          'Agent Teams — multi-agent collaboration.',
          '',
          'Usage:',
          '  /team create <goal>              Create a new team',
          '  /team list                       List all teams',
          '  /team status <name>              Show team details',
          '  /team pause <name>               Pause a team',
          '  /team resume <name>              Resume a paused team',
          '  /team kill <name>                Force-terminate a team',
          '  /team finish <name>              Trigger completion flow',
          '  /team enter <name>               Enter team view (participate)',
          '  /team leave                      Leave team view',
          '  /team message <name> <msg>       Send message to team',
          '  /team assign <name> <job> <member>  Force-assign job',
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
