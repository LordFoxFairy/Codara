import path from 'node:path';
import {ToolMessage} from '@langchain/core/messages';
import {resolveToolCallId} from '@core/agent/run/tool-executor';
import {createMiddleware, type BaseMiddleware, type BeforeModelContext, type ToolCallContext} from '@core/pipeline/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubagentCompletionContinuationContext {
  codaraSubagentCompletion?: {
    attempt?: number;
    previousInvalidResponse?: string;
    runs?: ReadonlyArray<SubagentCompletionRunEntry>;
  };
}

interface SubagentCompletionRunEntry {
  runId: string;
  label: string;
  agentName: string;
  status: 'completed' | 'failed';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

type SubagentReplayComparableRun = Readonly<{
  runId: string;
  label: string;
  agentName: string;
  status: string;
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}>;

// ---------------------------------------------------------------------------
// Validation pattern registry — declarative, easy to add/remove patterns
// ---------------------------------------------------------------------------

interface ValidationPattern {
  /** Human-readable label (used for debugging, not at runtime). */
  label: string;
  pattern: RegExp;
}

/**
 * Patterns that detect "still waiting for subagent results" language.
 * When matched, the model's response is considered invalid.
 */
const WAITING_PATTERNS: ValidationPattern[] = [
  {label: 'en:waiting-for-subagent', pattern: /waiting for (?:the )?(?:subagent|subagent run|subagent runs|subagent result|subagent results)/i},
  {label: 'en:wait-for-runtime', pattern: /wait for (?:runtime updates|the subagent result|review requests)/i},
  {label: 'zh:current-waiting', pattern: /当前.*等待.*(?:结果|返回|完成)/},
  {label: 'zh:waiting-for', pattern: /正在等待.*(?:子代理|后台任务|结果|返回)/},
  {label: 'zh:wait-result', pattern: /等待.*(?:子代理|后台任务).*(?:结果|返回|完成)/},
];

/**
 * Patterns that detect "future work / staged plan" language.
 * When matched, the model's response is considered invalid.
 */
const FUTURE_WORK_PATTERNS: ValidationPattern[] = [
  {label: 'en:phase-started', pattern: /\bphase\s*\d+\b.*(?:has started|started|is underway|is running)/i},
  {label: 'en:after-complete-will', pattern: /\b(?:after|once|when)\b[\s\S]{0,120}\b(?:complete|completed|finish(?:ed)?|return(?:ed|s)?)\b[\s\S]{0,120}\b(?:i|we)\b[\s\S]{0,40}\b(?:will|shall|then|can)\b/i},
  {label: 'en:will-after-complete', pattern: /\b(?:i|we)\b[\s\S]{0,40}\b(?:will|shall)\b[\s\S]{0,120}\b(?:after|once|when)\b[\s\S]{0,120}\b(?:complete|completed|finish(?:ed)?|return(?:ed|s)?)\b/i},
  {label: 'en:next-phase-will', pattern: /\b(?:next phase|second phase|later phase|next step|follow-up step|remaining work)\b[\s\S]{0,60}\b(?:will|shall|then|needs to|to be)\b/i},
  {label: 'en:until-all-done', pattern: /\b(?:only when|until)\b[\s\S]{0,120}\b(?:all|everything|all tasks|all subagents)\b[\s\S]{0,120}\b(?:complete|completed|done)\b[\s\S]{0,80}\b(?:will|shall|then)\b/i},
  {label: 'zh:phase-n-started', pattern: /已启动第[一二三四五六七八九十\d]+阶段/},
  {label: 'zh:current-phase', pattern: /当前.*(?:处于|还在).*(?:阶段|等待|进行中)/},
  {label: 'zh:after-complete-will', pattern: /(?:完成后|全部.*完成后).*?(?:我|我们).*?(?:将|会|再).*?(?:进入|启动|继续|执行|输出|总结|汇总|回答)/},
  {label: 'zh:next-phase-will', pattern: /(?:下一阶段|第二阶段|后续步骤|后续工作).*?(?:我|我们).*?(?:将|会|继续|启动|进入|执行)/},
  {label: 'zh:all-done-then', pattern: /(?:全部|所有).*(?:完成|结束).*后.*(?:再|才).*(?:输出|总结|汇总|回答)/},
  {label: 'zh:both-completed-summarize', pattern: /(?:两个|两条|all|both).*(?:subagent|子代理).*(?:已完成|都已完成|completed).*(?:现在|接下来|让我|let me|now).*(?:汇总|总结|summari[sz]e|synthesi[sz]e)/i},
  {label: 'mixed:completed-now-summarize', pattern: /(?:subagent|子代理).*(?:完成|completed).*(?:现在|接下来|让我|let me|now).*(?:汇总|总结|summari[sz]e|synthesi[sz]e)/i},
];

/** All invalid-response patterns merged for single-pass matching. */
const ALL_INVALID_PATTERNS = [...WAITING_PATTERNS, ...FUTURE_WORK_PATTERNS];

// ---------------------------------------------------------------------------
// System-message handoff instructions (static, extracted for clarity)
// ---------------------------------------------------------------------------

const COMPLETION_HANDOFF_INSTRUCTIONS = [
  'Completed subagent runs from your previous response are now available.',
  'Continue the parent task using these completed subagent results.',
  'If more work is still needed, immediately take the next step, including launching more subagent runs if appropriate.',
  'Only give a final user-facing answer once the entire original user request is satisfied.',
  'A completed subagent batch does not by itself mean the overall request is complete.',
  'If the user explicitly required later phases, serial follow-up steps, or additional analysis after this batch, do that next before answering.',
  'A progress-only update is not a valid completion.',
  'If your draft says work will continue later, that another phase will start later, or that you will answer after more results arrive, that draft is invalid.',
  'Either launch the required next-step work now or give the final answer only if no requested work remains.',
  'If the work is complete, respond with a unified user-facing answer.',
  'Do not claim the subagent work is still pending or that you are waiting for results that are already complete.',
  'Treat the completed subagent results below as finished work products, not as tasks to be restarted.',
  'Do not restart the plan from the beginning, do not relaunch the initial batch, and do not repeat a completed phase.',
  'Do not launch another subagent run that repeats, paraphrases, or only lightly rewords a completed topic listed below.',
  'If you launch more subagent runs, launch only the missing next-step work that builds on the completed results.',
  'Do not mention subagents, hidden handoff context, or orchestration stages in the user-visible answer.',
  'Do not structure the reply as per-task, per-subagent, or per-phase sections.',
  'Never write headings such as "Subagent report", "Phase 1", "First subagent", or similar orchestration labels.',
  'Do not restate task-by-task reports or raw child sections.',
  'Do not quote raw subagent output verbatim and do not mention hidden handoff context.',
  'The execution tree already showed the subagent work; your job is to synthesize the result for the user, not to replay child output.',
  'Use the completed subagent results below only as internal synthesis context:',
] as const;

const RETRY_CORRECTION_LINES = [
  'Your previous continuation was invalid because it still described the subagent work as waiting or staged.',
  'All completed subagent runs are already terminal. Do not say they are still pending, waiting, just started, or that another phase will continue later.',
] as const;

const REPEATED_CORRECTION_LINES = [
  'This is a repeated correction attempt.',
  'Do not provide another orchestration-status update, waiting update, or future-work promise.',
  'If you do not need to launch a new Agent tool call right now, respond with the actual final answer for the user in this turn.',
] as const;

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function createSubagentCompletionMiddleware(): BaseMiddleware {
  return createMiddleware({
    name: 'SubagentCompletion',
    beforeModel(context) {
      const handoff = buildSubagentCompletionHandoff(context);
      if (!handoff) {
        return undefined;
      }

      context.systemMessage.push(handoff);
      return undefined;
    },
    async wrapToolCall(context, handler) {
      const blocked = maybeHandleSubagentCompletionToolCall(context);
      if (blocked) {
        return blocked;
      }
      return await handler(context);
    },
  });
}

// ---------------------------------------------------------------------------
// Handoff builder
// ---------------------------------------------------------------------------

export function buildSubagentCompletionHandoff(context: BeforeModelContext): string | undefined {
  if (context.state.agentType !== 'main') {
    return undefined;
  }

  const runtimeContext = context.runtime.runtimeContext as SubagentCompletionContinuationContext | undefined;
  const runs = runtimeContext?.codaraSubagentCompletion?.runs;
  if (!runs?.length) {
    return undefined;
  }

  const attempt = runtimeContext?.codaraSubagentCompletion?.attempt ?? 1;
  const previousInvalidResponse = runtimeContext?.codaraSubagentCompletion?.previousInvalidResponse?.trim();

  const lines: string[] = [
    ...COMPLETION_HANDOFF_INSTRUCTIONS,
    ...runs.map((run) => formatSubagentCompletionLine(run)),
  ];

  if (attempt > 1) {
    lines.splice(3, 0, ...RETRY_CORRECTION_LINES);
    if (previousInvalidResponse) {
      lines.push(`Invalid previous draft (for correction only): ${summarizeDetail(previousInvalidResponse)}`);
    }
  }

  if (attempt > 2) {
    lines.splice(5, 0, ...REPEATED_CORRECTION_LINES);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool-call interceptors
// ---------------------------------------------------------------------------

export function maybeHandleSubagentCompletionToolCall(context: ToolCallContext): ToolMessage | undefined {
  if (shouldBlockInternalMemoryWrite(context)) {
    return new ToolMessage({
      content: 'Internal memory updates are deferred while completing subagent results. Finish the user request first by launching the next required Agent or by giving the final user-facing answer.',
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  const repeatedTopic = findRepeatedSubagentTopic(context);
  if (repeatedTopic) {
    return new ToolMessage({
      content: `This subagent run repeats already completed work (${repeatedTopic}). Do not relaunch a completed phase or topic. Launch only the missing next-step Agent, or give the final user-facing answer if nothing remains.`,
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Tool message builders
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

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

export function isInvalidSubagentCompletionResponse(
  text: string | undefined,
  runs: readonly SubagentReplayComparableRun[] = [],
): boolean {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  if (matchesAnyPattern(normalized)) {
    return true;
  }

  return containsRawSubagentReplay(normalized, runs);
}

export function shouldRetrySubagentCompletionResponse(input: {
  text: string | undefined;
  launchedSubagentToolCall?: boolean;
  attempt: number;
  maxAttempts: number;
  runs?: readonly SubagentReplayComparableRun[];
}): boolean {
  if (input.launchedSubagentToolCall) {
    return false;
  }

  if (input.attempt >= input.maxAttempts) {
    return false;
  }

  return !input.text?.trim() || isInvalidSubagentCompletionResponse(input.text, input.runs ?? []);
}

export function isSubagentInternalAssistantText(input: {
  text: string | undefined;
  runs?: readonly SubagentReplayComparableRun[];
}): boolean {
  if (!input.text?.trim()) {
    return false;
  }

  return isInvalidSubagentCompletionResponse(input.text, input.runs ?? []);
}

// ---------------------------------------------------------------------------
// Internal: pattern matching
// ---------------------------------------------------------------------------

function matchesAnyPattern(text: string): boolean {
  return ALL_INVALID_PATTERNS.some((entry) => entry.pattern.test(text));
}

// ---------------------------------------------------------------------------
// Internal: tool-call guards
// ---------------------------------------------------------------------------

function shouldBlockInternalMemoryWrite(context: ToolCallContext): boolean {
  const completion = readCompletionContext(context);
  if (!completion?.runs?.length) {
    return false;
  }

  const toolName = context.toolCall.name?.trim();
  if (toolName !== 'write_file' && toolName !== 'edit_file') {
    return false;
  }

  const targetPath = readToolTargetPath(context.toolCall.args);
  return Boolean(targetPath && isInternalCodaraMemoryPath(targetPath));
}

function findRepeatedSubagentTopic(context: ToolCallContext): string | undefined {
  const completion = readCompletionContext(context);
  if (!completion?.runs?.length) {
    return undefined;
  }

  if (context.toolCall.name?.trim() !== 'Agent') {
    return undefined;
  }

  const prompt = readSubagentPrompt(context.toolCall.args);
  const normalizedPrompt = normalizeForTaskComparison(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  for (const run of completion.runs) {
    if (run.status !== 'completed') {
      continue;
    }

    const topic = extractSubagentTopic(run.label, run.agentName, run.runId);
    const normalizedTopic = normalizeForTaskComparison(topic);
    if (!normalizedTopic) {
      continue;
    }

    if (isTaskRepeat(normalizedPrompt, normalizedTopic)) {
      return topic;
    }
  }

  return undefined;
}

function readCompletionContext(
  context: Pick<ToolCallContext, 'runtime'>,
): {
  runs?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>;
} | undefined {
  return (context.runtime.runtimeContext as {codaraSubagentCompletion?: {runs?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>}} | undefined)?.codaraSubagentCompletion;
}

// ---------------------------------------------------------------------------
// Internal: argument readers
// ---------------------------------------------------------------------------

function readSubagentPrompt(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const prompt = (args as Record<string, unknown>).prompt;
  return typeof prompt === 'string' ? prompt.trim() || undefined : undefined;
}

function readToolTargetPath(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const record = args as Record<string, unknown>;
  const candidate = typeof record.file_path === 'string'
    ? record.file_path
    : typeof record.path === 'string'
      ? record.path
      : undefined;
  return candidate?.trim() || undefined;
}

function isInternalCodaraMemoryPath(filePath: string): boolean {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)\.codara\/memory(?:\/|$)/.test(normalized)
    || /(?:^|\/)\.codara\/projects\/[^/]+\/memory(?:\/|$)/.test(normalized);
}

// ---------------------------------------------------------------------------
// Internal: formatting helpers
// ---------------------------------------------------------------------------

function formatSubagentCompletionLine(run: SubagentCompletionRunEntry): string {
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

function summarizeDetail(detail: string | undefined): string {
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

function extractSubagentTopic(label: string | undefined, agentName: string | undefined, runId: string): string {
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
// Internal: replay detection
// ---------------------------------------------------------------------------

function containsRawSubagentReplay(
  responseText: string,
  runs: readonly SubagentReplayComparableRun[],
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

// ---------------------------------------------------------------------------
// Internal: text normalization
// ---------------------------------------------------------------------------

function normalizeForReplayDetection(text: string | undefined): string | undefined {
  return text
    ?.toLocaleLowerCase()
    .replace(/[`*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function normalizeForTaskComparison(text: string | undefined): string | undefined {
  const normalized = text
    ?.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function isTaskRepeat(prompt: string, topic: string): boolean {
  if (prompt === topic) {
    return true;
  }

  if (prompt.length >= 48 && topic.length >= 48) {
    return prompt.includes(topic) || topic.includes(prompt);
  }

  return false;
}
