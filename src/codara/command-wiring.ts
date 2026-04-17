/**
 * Command execution wiring for Codara facade.
 *
 * Assembles the slash-command runner around a Session, wires the runtime event
 * relay (so commands can emit lifecycle events), and returns a controller that
 * the facade exposes on the public `Codara` handle.
 *
 * @module
 */

import {createCodaraCommandRunner, type CodaraCommandResult} from '@commands';
import {createSkillCodaraCommands} from '@commands/skill-commands';
import {createCodaraSkillsSource} from '@skills';
import type {Session} from '@state/session';
import type {CostTracker} from '@cost';
import type {HookRegistry} from '@hooks';
import type {McpManager} from '@mcp';
import type {CodaraRuntimeEvent, CodaraRuntimeEventListener} from '@events';
import type {CodaraOptions} from './types';

export interface CommandWiringInput {
  session: Session;
  costTracker: CostTracker;
  skillsSource?: ReturnType<typeof createCodaraSkillsSource>;
  alias: string;
  options: CodaraOptions;
  hookRegistry?: HookRegistry;
  mcpManager?: McpManager;
}

export interface CommandWiringResult {
  subscribeRuntimeEvents: (listener: CodaraRuntimeEventListener) => () => void;
  executeCommand: (raw: string) => Promise<CodaraCommandResult>;
  listCommands: ReturnType<typeof createCodaraCommandRunner>['listCommands'];
  eventListeners: Set<CodaraRuntimeEventListener>;
}

export function wireCommandExecution(input: CommandWiringInput): CommandWiringResult {
  const {session, costTracker, skillsSource, alias, options, hookRegistry, mcpManager} = input;
  const commandAgent = {
    ...session,
    ...(hookRegistry ? {hookRegistry} : {}),
    ...(mcpManager ? {getMcpStatus: () => mcpManager.status()} : {}),
    getCostSnapshot: () => costTracker.getSnapshot(),
  };
  const commands = createCodaraCommandRunner({
    agent: commandAgent,
    environment: {cwd: options.cwd, projectRoot: options.projectRoot, userHome: options.userHome, modelAlias: alias},
    ...(skillsSource ? {getDynamicCommands: () => createSkillCodaraCommands(skillsSource)} : {}),
  });

  const eventListeners = new Set<CodaraRuntimeEventListener>();
  const subscribeRuntimeEvents = (listener: CodaraRuntimeEventListener) => {
    const unsub = session.subscribeRuntimeEvents(listener);
    eventListeners.add(listener);
    return () => {
      unsub();
      eventListeners.delete(listener);
    };
  };
  const emitEvent = (payload: Omit<CodaraRuntimeEvent, 'sessionId' | 'timestamp'>) => {
    const event: CodaraRuntimeEvent = {...payload, sessionId: session.getState().sessionId, timestamp: new Date().toISOString()};
    for (const listener of eventListeners) listener(event);
  };
  const executeCommand = async (raw: string): Promise<CodaraCommandResult> => {
    const id = `command:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    emitEvent({id, kind: 'command', phase: 'start', status: 'running', label: `Running ${raw.trim()}`});
    const result = await commands.executeCommand(raw);
    emitEvent({
      id: `command:end:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind: 'command',
      phase: 'end',
      status: result.ok ? 'done' : 'error',
      label: result.ok ? `Completed ${raw.trim()}` : `Failed ${raw.trim()}`,
      detail: result.output.trim() || undefined,
      parentId: id,
    });
    return result;
  };

  return {subscribeRuntimeEvents, executeCommand, listCommands: commands.listCommands, eventListeners};
}
