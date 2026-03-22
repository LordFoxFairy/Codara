import {useEffect, useMemo, useState} from 'react';
import type {Codara, SubagentRunQuerySummary} from '@/index';
import {
  buildSolidifiedItemsFromRange,
  createToolCallLookup,
  type TranscriptItem,
} from '../transcript/model';

export interface UseSubagentRunDetailsInput {
  codara: Codara;
  runs: readonly SubagentRunQuerySummary[];
  enabled: boolean;
}

export function useSubagentRunDetails(input: UseSubagentRunDetailsInput): ReadonlyMap<string, TranscriptItem[]> {
  const {codara, runs, enabled} = input;
  const [details, setDetails] = useState<ReadonlyMap<string, TranscriptItem[]>>(new Map());
  const runIds = useMemo(
    () => runs.map((run) => run.runId).filter(Boolean),
    [runs],
  );

  useEffect(() => {
    if (!enabled || runIds.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const detailRecords = await codara.getSubagentRunDetails(runIds);
      if (cancelled) {
        return;
      }

      const next = new Map<string, TranscriptItem[]>();
      for (const detail of detailRecords) {
        const toolLookup = createToolCallLookup(detail.messages);
        const items = buildSolidifiedItemsFromRange(
          detail.messages,
          0,
          detail.messages.length,
          toolLookup,
        ).filter((item) => item.role !== 'user');
        if (items.length > 0) {
          next.set(detail.runId, items);
        }
      }

      setDetails(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [codara, enabled, runIds]);

  if (!enabled || runIds.length === 0) {
    return new Map();
  }

  return details;
}
