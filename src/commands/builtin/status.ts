import path from 'node:path';
import {homedir} from 'node:os';
import type {CodaraCommandDefinition} from '@commands/runtime/types';
import {resolvePermissionSettingsFile} from '@core/middleware/permission';
import {resolveWorkspaceRoot} from '@config/workspace';
import {BUILTIN_SOURCE, formatContextWindow, formatFilePath, formatUsage} from './formatters';

export const statusCommand: CodaraCommandDefinition = {
  name: 'status',
  usage: '/status',
  description: 'Show the current runtime, session, context window, memory, and permission status.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent, environment}) {
    const session = agent.getState();
    const state = await agent.hydrate();
    const projectRoot = resolveWorkspaceRoot({
      cwd: environment.cwd,
      projectRoot: environment.projectRoot,
    });
    const permissionFile = resolvePermissionSettingsFile(environment);
    const projectMemory = path.join(projectRoot, 'AGENTS.md');
    const globalMemory = path.join(environment.userHome ?? homedir(), '.codara', 'AGENTS.md');
    const contextWindow = session.metadata?.contextWindow;
    const usage = session.metadata?.usage;

    return {
      ok: true,
      command: command.name,
      output: [
        'Runtime status:',
        `- session: ${session.sessionId}`,
        `- session_status: ${session.sessionStatus}`,
        `- agent_status: ${state.status}`,
        `- model: ${environment.modelAlias ?? 'default'}`,
        `- messages: ${session.metadata?.messageCount ?? state.messages.length}`,
        `- last_activity: ${session.metadata?.lastActivity ?? 'n/a'}`,
        `- context: ${formatContextWindow(contextWindow)}`,
        `- usage: ${formatUsage(usage)}`,
        `- pending_review: ${state.pendingReview ? 'yes' : 'no'}`,
        `- project_memory: ${formatFilePath(projectMemory)}`,
        `- global_memory: ${formatFilePath(globalMemory)}`,
        `- permissions: ${permissionFile}`,
      ].join('\n'),
    };
  },
};

