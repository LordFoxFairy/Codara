import type {AgentRunStore} from '@capability/subagent';
import type {AgentRunQuerySummary} from '../types';

export function getAgentRunSummaries(
  store: AgentRunStore | undefined,
  sessionId: string | undefined,
): AgentRunQuerySummary[] {
  if (!store) {
    return [];
  }

  return store.list()
    .filter((run) => !sessionId || run.parentSessionId === sessionId)
    .map((run) => ({
      runId: run.runId,
      sessionId: run.parentSessionId,
      parentSessionId: run.parentSessionId,
      label: run.label,
      agentName: run.agentName,
      status: run.status,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      ...(run.endedAt ? {endedAt: run.endedAt} : {}),
      ...(run.childSessionId ? {childSessionId: run.childSessionId} : {}),
      ...(run.latestActivity ? {latestActivity: run.latestActivity} : {}),
      ...(run.summary ? {summary: run.summary} : {}),
      ...(run.errorMessage ? {errorMessage: run.errorMessage} : {}),
      ...(run.reason ? {reason: run.reason} : {}),
      ...(typeof run.turns === 'number' ? {turns: run.turns} : {}),
      ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
      ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
    }));
}
