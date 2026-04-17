/**
 * Transcript renderer — entry points consumed by shell / solidified-block / tests.
 *
 * Presentational helpers live in sibling modules:
 * - render-block.tsx: TranscriptBlock, ToolResultBlock
 * - render-task.tsx: SingleTaskExecutionBlock
 */
import React from 'react';
import type {CodaraRuntimeEvent} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {Box} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import type {ActiveSubagentRun} from '../subagent/use-runs';
import {buildTranscriptItems, dedupeCanonicalTranscriptItems, type ToolResultMeta, type TranscriptItem} from './model';
import {TranscriptBlock, ToolResultBlock} from './render-block';
import {SingleTaskExecutionBlock, resolveSubagentRunId} from './render-task';

interface TranscriptProps {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  subagentDetails?: ReadonlyMap<string, TranscriptItem[]>;
  expandedAll?: boolean;
}

export function Transcript({coreMessages, notices, activeTurn, runtimeEvents, subagentDetails, expandedAll = false}: TranscriptProps): React.JSX.Element {
  const items = buildTranscriptItems({coreMessages, notices, activeTurn, runtimeEvents});
  return <TranscriptItemsView items={items} subagentDetails={subagentDetails} expandedAll={expandedAll} />;
}

/** Renders pre-filtered active (streaming) transcript items. */
export function ActiveTranscript({
  items,
  activeSubagentRuns = [],
  expandedAll = false,
  subagentDetails,
}: {
  items: TranscriptItem[];
  activeSubagentRuns?: readonly ActiveSubagentRun[];
  expandedAll?: boolean;
  subagentDetails?: ReadonlyMap<string, TranscriptItem[]>;
}): React.JSX.Element {
  return <TranscriptItemsView items={items} activeSubagentRuns={activeSubagentRuns} expandedAll={expandedAll} subagentDetails={subagentDetails} />;
}

export function TranscriptItemsView({
  items,
  activeSubagentRuns = [],
  expandedAll = false,
  subagentDetails,
}: {
  items: TranscriptItem[];
  activeSubagentRuns?: readonly ActiveSubagentRun[];
  expandedAll?: boolean;
  subagentDetails?: ReadonlyMap<string, TranscriptItem[]>;
}): React.JSX.Element {
  const canonicalItems = dedupeCanonicalTranscriptItems(items);
  const hasForegroundActiveSubagentRuns = activeSubagentRuns.some((run) => run.status === 'running' || run.status === 'paused');
  const transcriptOwnsRunningSubagentBlock = canonicalItems.some((item) => (
    item.role === 'agent'
    && (item.toolMeta?.status === 'running' || item.toolMeta?.status === 'paused')
  ));
  const hideAssistantNarrationWhileSubagentsRun = hasForegroundActiveSubagentRuns || transcriptOwnsRunningSubagentBlock;
  const visibleItems = canonicalItems.filter((item) => {
    if (!hideAssistantNarrationWhileSubagentsRun) {
      return true;
    }
    return item.role !== 'assistant' && item.role !== 'system';
  });

  const blocks: React.JSX.Element[] = [];
  for (const item of visibleItems) {
    if (item.role === 'agent' && item.toolMeta) {
      const taskItem = item as TranscriptItem & {toolMeta: ToolResultMeta};
      const runId = resolveSubagentRunId(taskItem);
      const activeTask = runId ? activeSubagentRuns.find((run) => run.id === runId) : undefined;
      blocks.push(
        <SingleTaskExecutionBlock
          key={taskItem.id}
          item={taskItem}
          activeTask={activeTask}
          expanded={expandedAll}
          detailItems={runId ? subagentDetails?.get(runId) : undefined}
          subagentDetails={subagentDetails}
          renderChildren={(childItems, childDetails) => (
            <TranscriptItemsView
              items={childItems}
              activeSubagentRuns={[]}
              expandedAll
              subagentDetails={childDetails}
            />
          )}
        />,
      );
      continue;
    }

    blocks.push(
      item.toolMeta ? (
        <ToolResultBlock key={item.id} meta={item.toolMeta} expanded={expandedAll} />
      ) : (
        <TranscriptBlock key={item.id} role={item.role} content={item.content} renderHint={item.renderHint} tokenAnnotation={item.tokenAnnotation} />
      ),
    );
  }

  return (
    <Box flexDirection="column">
      {blocks}
    </Box>
  );
}

// Re-export presentational blocks so existing test imports keep working.
export {TranscriptBlock, ToolResultBlock} from './render-block';
