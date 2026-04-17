/** Subagent run detail query -- loads full message history from checkpoints. */

import type {AgentCheckpointer} from '@state/checkpoint';
import type {SubagentRunStore} from '@tasks/subagent';
import type {SubagentRunQueryDetail} from '../types';

/** Load message-level details for specific subagent runs (or all runs under a parent session). */
export async function getSubagentRunDetails(input: {
  store: SubagentRunStore | undefined;
  checkpointer: AgentCheckpointer | undefined;
  parentSessionId: string | undefined;
  runIds?: readonly string[];
}): Promise<SubagentRunQueryDetail[]> {
  const {store, checkpointer, parentSessionId, runIds} = input;
  if (!store || !checkpointer) {
    return [];
  }

  const allowedRunIds = runIds?.length ? new Set(runIds.map((runId) => runId.trim()).filter(Boolean)) : undefined;
  const runs = store.list().filter((run) => {
    if (parentSessionId && run.parentSessionId !== parentSessionId) {
      return false;
    }
    if (allowedRunIds && !allowedRunIds.has(run.runId)) {
      return false;
    }
    return Boolean(run.childSessionId);
  });

  const details = await Promise.all(runs.map(async (run) => {
    const checkpoint = await checkpointer.getLatest(run.childSessionId!);
    if (!checkpoint) {
      return undefined;
    }

    return {
      runId: run.runId,
      childSessionId: run.childSessionId!,
      messages: checkpoint.state.messages,
    } satisfies SubagentRunQueryDetail;
  }));

  return details.filter((detail): detail is SubagentRunQueryDetail => Boolean(detail));
}
