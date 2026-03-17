import type {CodaraCommandDefinition, CodaraCommandResult} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const teamCommand: CodaraCommandDefinition = {
  name: 'team',
  usage: '/team <create|list|status|health|jobs|pause|resume|kill|finish|enter|leave|message|assign>',
  description: 'Manage Codara Agent Teams — create, monitor, and control multi-agent teams.',
  source: BUILTIN_SOURCE,
  aliases: ['t'],
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent}) {
    const sub = command.args[0]?.toLowerCase();
    const args = command.args.slice(1);

    const registry = agent.teamRegistry;
    const runtime = agent.teamRuntime;

    if (!registry || !runtime) {
      return err(command.name, 'Team system not initialized. TeamRegistry/TeamRuntime not available.');
    }

    switch (sub) {
      case 'create': {
        const goal = args.join(' ');
        if (!goal) return err(command.name, 'Usage: /team create <goal>');
        try {
          const name = `team-${Date.now().toString(36)}`;
          const team = registry.createTeam({name, goal});
          await runtime.startTeam(team.teamId);
          return ok(command.name, `Team created and started.\n  ID: ${team.teamId}\n  Name: ${team.name}\n  Goal: ${goal}\n  Status: running`);
        } catch (e) {
          return err(command.name, `Failed to create team: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'list': {
        const teams = registry.listTeams();
        if (teams.length === 0) {
          return ok(command.name, 'No active teams.\n\nUse /team create <goal> to start a team.');
        }
        const header = 'ID                Name              Status      Goal';
        const separator = '─'.repeat(72);
        const rows = teams.map(t => {
          const id = t.teamId.padEnd(18);
          const name = t.name.padEnd(18);
          const status = t.status.padEnd(12);
          return `${id}${name}${status}${t.goal}`;
        });
        return ok(command.name, [header, separator, ...rows].join('\n'));
      }
      case 'status': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team status <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const members = registry.getMembersByTeam(team.teamId);
        const jobBoard = registry.getJobBoard(team.teamId);
        const jobs = jobBoard.getAllJobs();
        const lines = [
          `Team: ${team.name} (${team.teamId})`,
          `Status: ${team.status}`,
          `Goal: ${team.goal}`,
          `Depth: ${team.depth}`,
          `Created: ${team.createdAt}`,
          '',
          `Members (${members.length}):`,
          ...members.map(m => `  ${m.role.padEnd(8)} ${m.name.padEnd(16)} ${m.status.padEnd(14)} ${m.memberId}`),
          '',
          `Jobs (${jobs.length}):`,
          ...jobs.map(j => `  [${j.status.padEnd(12)}] ${j.title} (${j.id})`),
        ];
        return ok(command.name, lines.join('\n'));
      }
      case 'pause': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team pause <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        try {
          runtime.pauseTeam(team.teamId);
          return ok(command.name, `Team "${team.name}" paused.`);
        } catch (e) {
          return err(command.name, `Failed to pause team: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'resume': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team resume <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        try {
          runtime.resumeTeam(team.teamId);
          return ok(command.name, `Team "${team.name}" resumed.`);
        } catch (e) {
          return err(command.name, `Failed to resume team: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'kill': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team kill <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        try {
          await runtime.killTeam(team.teamId);
          return ok(command.name, `Team "${team.name}" killed.`);
        } catch (e) {
          return err(command.name, `Failed to kill team: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'finish': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team finish <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        try {
          await runtime.shutdownTeam(team.teamId);
          return ok(command.name, `Team "${team.name}" shutdown complete.`);
        } catch (e) {
          return err(command.name, `Failed to finish team: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'enter': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team enter <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        return {
          ok: true,
          command: command.name,
          output: `Entered team "${team.name}". Type messages to interact.`,
          action: {type: 'enter_team', teamId: team.teamId},
        };
      }
      case 'leave':
        return {
          ok: true,
          command: command.name,
          output: 'Left team view. Back to global dashboard.',
          action: {type: 'leave_team'},
        };
      case 'message': {
        const name = args[0];
        const msg = args.slice(1).join(' ');
        if (!name || !msg) return err(command.name, 'Usage: /team message <name> <message>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const transport = runtime.getTransport(team.teamId);
        if (!transport) return err(command.name, `Team "${name}" transport not available.`);
        try {
          await transport.send('broadcast', {
            id: `msg_${crypto.randomUUID().slice(0, 8)}`,
            from: 'user',
            to: 'broadcast',
            teamId: team.teamId,
            type: 'message',
            content: msg,
            timestamp: new Date().toISOString(),
            read: false,
          });
          return ok(command.name, `Message sent to team "${team.name}".`);
        } catch (e) {
          return err(command.name, `Failed to send message: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'logs': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team logs <name> [count]');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const msgLog = runtime.getMessageLog(team.teamId);
        if (!msgLog || !msgLog.exists()) return ok(command.name, 'No message log available for this team.');
        const count = parseInt(args[1] ?? '20', 10);
        const recent = msgLog.readRecent(count);
        if (recent.length === 0) return ok(command.name, 'No messages in team log.');
        const lines = recent.map(m => {
          const time = m.timestamp.slice(11, 19);
          return `[${time}] ${m.from} → ${m.to}: ${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}`;
        });
        return ok(command.name, `Team "${team.name}" messages (last ${recent.length}):\n${lines.join('\n')}`);
      }
      case 'budget': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team budget <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const tracker = runtime.getBudgetTracker(team.teamId);
        if (!tracker) return ok(command.name, 'No budget tracker active for this team.');
        const usage = tracker.getUsage();
        const check = tracker.checkBudget();
        const lines = [
          `Team Budget: ${team.name}`,
          `  Total tokens: ${usage.totalTokens.toLocaleString()} (↓${usage.totalInputTokens.toLocaleString()} ↑${usage.totalOutputTokens.toLocaleString()})`,
          `  Estimated cost: $${usage.estimatedCost.toFixed(4)}`,
          `  Budget used: ${check.usedPercent}% (${check.action === 'none' ? 'OK' : check.action.toUpperCase()})`,
          '',
          'By member:',
        ];
        for (const [, m] of usage.byMember) {
          lines.push(`  ${m.memberId}: ${(m.inputTokens + m.outputTokens).toLocaleString()} tokens (${m.turns} turns, model: ${m.model})`);
        }
        return ok(command.name, lines.join('\n'));
      }
      case 'assign': {
        const [name, jobId, memberId] = args;
        if (!name || !jobId || !memberId) return err(command.name, 'Usage: /team assign <name> <jobId> <memberId>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const jobBoard = registry.getJobBoard(team.teamId);
        try {
          jobBoard.claimJob(jobId, memberId);
          return ok(command.name, `Job ${jobId} assigned to ${memberId} in team "${team.name}".`);
        } catch (e) {
          return err(command.name, `Failed to assign job: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'health': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team health <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const jobBoard = registry.getJobBoard(team.teamId);
        const deadlocked = jobBoard.detectDeadlock();
        const progress = jobBoard.getProgress();
        const tracker = runtime.getBudgetTracker(team.teamId);
        const members = registry.getMembersByTeam(team.teamId);
        const idleMembers = members.filter(m => m.status === 'idle');
        const workingMembers = members.filter(m => m.status === 'working');
        const lines = [
          `Team Health: ${team.name} (${team.status})`,
          '',
          `Jobs: ${progress.done}/${progress.total} done, ${progress.inProgress} in progress, ${progress.blocked} blocked`,
          `Deadlock: ${deadlocked ? '⚠ YES — all remaining jobs are blocked' : '✓ No'}`,
          '',
          `Members: ${members.length} total (${workingMembers.length} working, ${idleMembers.length} idle)`,
        ];
        if (tracker) {
          const check = tracker.checkBudget();
          lines.push(`Budget: ${check.usedPercent}% used (${check.action === 'none' ? 'OK' : check.action.toUpperCase()})`);
        }
        return ok(command.name, lines.join('\n'));
      }
      case 'jobs': {
        const name = args[0];
        if (!name) return err(command.name, 'Usage: /team jobs <name>');
        const team = registry.getTeamByName(name) ?? registry.getTeam(name);
        if (!team) return err(command.name, `Team "${name}" not found.`);
        const jobBoard = registry.getJobBoard(team.teamId);
        const jobs = jobBoard.getAllJobs();
        if (jobs.length === 0) return ok(command.name, 'No jobs on the board.\n\nUse plan_jobs tool to add jobs.');
        const header = 'ID                Status        Assignee          Title';
        const separator = '─'.repeat(76);
        const rows = jobs.map(j => {
          const id = j.id.padEnd(18);
          const status = j.status.padEnd(14);
          const assignee = (j.assignee ?? '—').padEnd(18);
          return `${id}${status}${assignee}${j.title}`;
        });
        return ok(command.name, [header, separator, ...rows].join('\n'));
      }
      default:
        return ok(command.name, [
          'Agent Teams — multi-agent collaboration.',
          '',
          'Usage:',
          '  /team create <goal>              Create a new team',
          '  /team list                       List all teams',
          '  /team status <name>              Show team details',
          '  /team health <name>              Show team health (deadlock, budget)',
          '  /team jobs <name>                Show job board',
          '  /team pause <name>               Pause a team',
          '  /team resume <name>              Resume a paused team',
          '  /team kill <name>                Force-terminate a team',
          '  /team finish <name>              Trigger completion flow',
          '  /team enter <name>               Enter team view (participate)',
          '  /team leave                      Leave team view',
          '  /team message <name> <msg>       Send message to team',
          '  /team logs <name> [count]        Show recent team messages',
          '  /team budget <name>              Show team budget usage',
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
