import type {TaskRunStore} from '@capability/task';
import type {TaskRunQuerySummary} from '../types';

export function getTaskRunSummaries(
  store: TaskRunStore | undefined,
  sessionId: string | undefined,
): TaskRunQuerySummary[] {
  if (!store) {
    return [];
  }

  return store.list()
    .filter((run) => !sessionId || run.sessionId === sessionId)
    .map((run) => ({
      runId: run.runId,
      sessionId: run.sessionId,
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
