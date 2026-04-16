import type {CodaraCommandDefinition} from '@capability/command/runtime/types';
import {BUILTIN_SOURCE} from './formatters';

export const hooksCommand: CodaraCommandDefinition = {
  name: 'hooks',
  usage: '/hooks',
  description: 'List all registered hooks by event type.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({agent}) {
    const registry = agent.hookRegistry;
    if (!registry || registry.size === 0) {
      return {
        ok: true,
        command: 'hooks',
        output: 'No hooks registered. Create `.codara/hooks.json` to add hooks.',
      };
    }

    const lines: string[] = [`Registered hooks: ${registry.size} total\n`];

    const eventTypes = [
      'SessionStart', 'SessionEnd', 'UserPromptSubmit',
      'PreCompact', 'PostCompact',
      'Stop', 'SubagentStop',
      'PreToolUse', 'PostToolUse',
    ] as const;

    for (const eventType of eventTypes) {
      const hooks = registry.getHooks(eventType);
      if (hooks.length === 0) continue;

      lines.push(`## ${eventType} (${hooks.length})`);
      for (const entry of hooks) {
        const def = entry.definition;
        const cmd = def.type === 'command'
          ? def.command!.slice(0, 60)
          : `[prompt] ${def.prompt!.slice(0, 50)}...`;
        const matcher = def.matcher
          ? ` (${def.matcher.toolName ?? ''}${def.matcher.commandPattern ? ' /' + def.matcher.commandPattern + '/' : ''})`
          : '';
        lines.push(`  - [${entry.source.kind}] ${cmd}${matcher}`);
      }
      lines.push('');
    }

    return {
      ok: true,
      command: 'hooks',
      output: lines.join('\n'),
    };
  },
};
