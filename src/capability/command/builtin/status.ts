import {existsSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import type {CodaraCommandDefinition} from '@capability/command/runtime/types';
import {resolvePermissionSettingsFile} from '@engine/pipeline/permission';
import {resolveWorkspaceRoot} from '@infra/config/workspace';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

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
        `- pending_review: ${state.pendingPause ? 'yes' : 'no'}`,
        `- project_memory: ${projectMemory}${existsSync(projectMemory) ? '' : ' (missing)'}`,
        `- global_memory: ${globalMemory}${existsSync(globalMemory) ? '' : ' (missing)'}`,
        `- permissions: ${permissionFile}`,
      ].join('\n'),
    };
  },
};

function formatContextWindow(contextWindow: {
  maxInputTokens: number;
  availableInputTokens: number;
  estimatedInputTokens: number;
  usagePercent: number;
  overBudget: boolean;
} | undefined): string {
  if (!contextWindow) {
    return 'n/a';
  }

  return `${Math.round(contextWindow.usagePercent)}% (${contextWindow.estimatedInputTokens}/${contextWindow.maxInputTokens})${contextWindow.overBudget ? ' over-budget' : ''}`;
}

function formatUsage(usage: {
  modelCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} | undefined): string {
  if (!usage) {
    return 'n/a';
  }

  return `model_calls=${usage.modelCalls ?? 0}, prompt=${usage.promptTokens ?? 0}, completion=${usage.completionTokens ?? 0}, total=${usage.totalTokens ?? 0}`;
}
