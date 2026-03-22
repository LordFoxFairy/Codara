import type {SubagentRunStore} from '@capability/subagent';
import type {SubagentRunQuerySummary} from '../types';

export function getSubagentRunSummaries(
  store: SubagentRunStore | undefined,
  parentSessionId: string | undefined,
): SubagentRunQuerySummary[] {
  if (!store) {
    return [];
  }

  return store.list()
    .filter((run) => !parentSessionId || run.parentSessionId === parentSessionId)
    .map((run) => ({
      runId: run.runId,
      parentSessionId: run.parentSessionId,
      label: run.label,
      agentName: run.agentName,
      status: run.status,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      ...(run.endedAt ? {endedAt: run.endedAt} : {}),
      ...(run.childSessionId ? {childSessionId: run.childSessionId} : {}),
      ...(run.latestActivity ? {latestActivity: run.latestActivity} : {}),
      ...(run.activityLog?.length ? {activityLog: [...run.activityLog]} : {}),
      ...(run.summary ? {summary: run.summary} : {}),
      ...(run.errorMessage ? {errorMessage: run.errorMessage} : {}),
      ...(run.reason ? {reason: run.reason} : {}),
      ...(typeof run.turns === 'number' ? {turns: run.turns} : {}),
      ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
      ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
    }));
}
