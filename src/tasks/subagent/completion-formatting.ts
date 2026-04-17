/**
 * Formatting + text-normalization helpers for subagent completion.
 *
 * Factored out of `completion.ts` so the main file can focus on
 * middleware wiring + response validation.
 *
 * @module
 */

import {ToolMessage} from '@langchain/core/messages';

// ---------------------------------------------------------------------------
// Shared type — identical shape used across completion modules
// ---------------------------------------------------------------------------

export interface SubagentCompletionRunEntry {
  readonly runId: string;
  readonly label: string;
  readonly agentName: string;
  readonly status: 'completed' | 'failed';
  readonly summary?: string;
  readonly errorMessage?: string;
  readonly toolUseCount?: number;
  readonly totalTokens?: number;
}

export interface SubagentRunComparableEntry {
  readonly runId: string;
  readonly label: string;
  readonly agentName: string;
  readonly status: string;
  readonly summary?: string;
  readonly errorMessage?: string;
  readonly toolUseCount?: number;
  readonly totalTokens?: number;
}

// ---------------------------------------------------------------------------
// Tool-message builders
// ---------------------------------------------------------------------------

export function createSubagentCompletionToolMessages(
  runs: readonly SubagentCompletionRunEntry[],
): ToolMessage[] {
  return runs.map((run) => new ToolMessage({
    content: buildToolMessageContent(run),
    artifact: {
      type: 'subagent_result',
      sessionId: run.runId,
      turns: 0,
      reason: run.status === 'failed' ? 'error' : 'complete',
      runId: run.runId,
      label: run.label,
      agentName: run.agentName,
      ...(run.summary ? {summary: run.summary} : {}),
      ...(run.errorMessage ? {errorMessage: run.errorMessage} : {}),
      ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
      ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
    },
    status: run.status === 'failed' ? 'error' : 'success',
    tool_call_id: run.runId,
  }));
}

export function formatSubagentCompletionLine(run: SubagentCompletionRunEntry): string {
  const topic = extractSubagentTopic(run.label, run.agentName, run.runId);
  const status = run.status === 'failed' ? 'failed' : 'completed';
  const stats: string[] = [];
  if (typeof run.toolUseCount === 'number' && run.toolUseCount > 0) {
    stats.push(`${run.toolUseCount} tool uses`);
  }
  if (typeof run.totalTokens === 'number' && run.totalTokens > 0) {
    stats.push(`${formatCompactNumber(run.totalTokens)} tokens`);
  }
  const detail = run.status === 'failed'
    ? summarizeDetail(run.errorMessage?.trim() || run.summary?.trim())
    : summarizeDetail(run.summary?.trim());
  const statSuffix = stats.length > 0 ? ` | stats: ${stats.join(' · ')}` : '';
  return `- topic: ${topic} | status: ${status}${statSuffix}\n  finding: ${detail}`;
}

export function summarizeDetail(detail: string | undefined): string {
  const text = detail
    ?.replace(/[*_`#>-]+/g, ' ')
    ?.replace(/\s+/g, ' ')
    ?.trim()
    ?.replace(/[.。!！]+$/, '');
  if (!text) {
    return 'No summary was recorded.';
  }
  if (text.length <= 140) {
    return text;
  }
  return `${text.slice(0, 137).trimEnd()}...`;
}

export function extractSubagentTopic(label: string | undefined, agentName: string | undefined, runId: string): string {
  const raw = label?.trim() || agentName?.trim() || runId;
  const stripped = raw
    .replace(/^Delegating\s+[^:]+:\s*/i, '')
    .replace(/^Delegating\s+/i, '')
    .trim();
  return stripped || raw;
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) {
    const compact = (value / 1000);
    const rendered = compact >= 10 ? compact.toFixed(0) : compact.toFixed(1);
    return `${rendered.replace(/\.0$/, '')}k`;
  }
  return String(value);
}

function buildToolMessageContent(run: SubagentCompletionRunEntry): string {
  const lines = [
    run.status === 'failed' ? 'Subagent failed.' : 'Subagent completed.',
    `run_id: ${run.runId}`,
    `agent: ${run.agentName}`,
    `topic: ${extractSubagentTopic(run.label, run.agentName, run.runId)}`,
  ];

  if (typeof run.toolUseCount === 'number' && run.toolUseCount > 0) {
    lines.push(`tool_uses: ${run.toolUseCount}`);
  }
  if (typeof run.totalTokens === 'number' && run.totalTokens > 0) {
    lines.push(`tokens: ${run.totalTokens}`);
  }
  if (run.status === 'failed' && run.errorMessage?.trim()) {
    lines.push(`error: ${summarizeDetail(run.errorMessage)}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Text normalization (used by validation + replay detection)
// ---------------------------------------------------------------------------

export function normalizeForReplayDetection(text: string | undefined): string | undefined {
  return text
    ?.toLocaleLowerCase()
    .replace(/[`*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

export function normalizeForTaskComparison(text: string | undefined): string | undefined {
  const normalized = text
    ?.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

// ---------------------------------------------------------------------------
// Replay detection — does a response text regurgitate subagent summaries?
// ---------------------------------------------------------------------------

export function containsRawSubagentReplay(
  responseText: string,
  runs: readonly SubagentRunComparableEntry[],
): boolean {
  const normalizedResponse = normalizeForReplayDetection(responseText);
  if (!normalizedResponse) {
    return false;
  }

  return runs.some((run) => {
    if (run.status !== 'completed' && run.status !== 'failed') {
      return false;
    }
    const rawDetail = run.status === 'failed'
      ? run.errorMessage?.trim() || run.summary?.trim()
      : run.summary?.trim();
    const normalizedDetail = normalizeForReplayDetection(rawDetail);
    if (!normalizedDetail) {
      return false;
    }

    // Short details: exact substring match
    if (normalizedDetail.length <= 80 && normalizedResponse.includes(normalizedDetail)) {
      return true;
    }

    // Longer details: line-by-line candidate matching
    return buildReplayCandidates(rawDetail ?? '').some(
      (candidate) => normalizedResponse.includes(candidate),
    );
  });
}

function buildReplayCandidates(detail: string): string[] {
  const normalized = detail
    .split('\n')
    .map((line) => normalizeForReplayDetection(line))
    .filter((line): line is string => Boolean(line && line.length >= 48))
    .slice(0, 8);

  if (normalized.length > 0) {
    return normalized;
  }

  const fallback = normalizeForReplayDetection(detail);
  if (!fallback) {
    return [];
  }

  return fallback.length >= 64 ? [fallback.slice(0, 96)] : [fallback];
}
