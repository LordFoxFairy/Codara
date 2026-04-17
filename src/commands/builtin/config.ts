import path from 'node:path';
import type {CodaraCommandDefinition} from '@commands/types';
import {BUILTIN_SOURCE} from './formatters';

export const configCommand: CodaraCommandDefinition = {
  name: 'config',
  usage: '/config [edit]',
  description: 'View or modify runtime configuration.',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, agent, environment}) {
    const args = command.argsText.trim();

    // /config edit → open config file in editor
    if (args === 'edit') {
      const projectRoot = environment.projectRoot ?? environment.cwd ?? process.cwd();
      const configPath = path.join(projectRoot, '.codara', 'config.json');
      return {
        ok: true,
        command: command.name,
        output: `Opening ${configPath}`,
        action: {type: 'open_file' as const, path: configPath},
      };
    }

    // /config (no args) → show comprehensive info
    const state = agent.getState();
    const tools = agent.getAvailableToolNames();
    const mcpStatus = agent.getMcpStatus?.() ?? [];

    const lines: string[] = [];
    lines.push('Runtime Configuration');
    lines.push('');
    lines.push(`  Model:        ${environment.modelAlias ?? 'default'}`);
    if (environment.modelAliases && environment.modelAliases.length > 0) {
      lines.push(`  Aliases:      ${environment.modelAliases.join(', ')}`);
    }
    lines.push(`  CWD:          ${environment.cwd ?? process.cwd()}`);
    lines.push(`  Project Root: ${environment.projectRoot ?? 'auto-detected'}`);
    lines.push(`  Session:      ${state.sessionId}`);
    lines.push(`  Tools:        ${tools.length} available`);

    if (mcpStatus.length > 0) {
      const connected = mcpStatus.filter(s => s.status === 'connected').length;
      lines.push(`  MCP Servers:  ${connected}/${mcpStatus.length} connected`);
    }

    if (state.metadata?.usage) {
      const u = state.metadata.usage;
      lines.push('');
      lines.push('  Usage:');
      lines.push(`    API Calls:        ${u.modelCalls ?? 0}`);
      lines.push(`    Prompt Tokens:    ${u.promptTokens ?? 0}`);
      lines.push(`    Completion Tokens: ${u.completionTokens ?? 0}`);
    }

    lines.push('');
    lines.push('  Use /config edit to open .codara/config.json in your editor.');

    return {ok: true, command: command.name, output: lines.join('\n')};
  },
};
