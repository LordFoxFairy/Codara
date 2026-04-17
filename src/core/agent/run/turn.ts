import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {executeToolCall, resolveToolCallId} from './tool-executor';
import type {AgentStreamWriter} from './stream';
import {
  chunkToMessage,
  createTurnContext,
  throwIfAborted,
  toMessageChunk,
  type AgentRunContext,
  type AgentRuntime,
} from './agent-loop';
import {
  readExecutionMetadata,
  type AgentRunSummary,
  type BaseExecutionContext,
  type ModelCallContext,
  type ToolCallContext,
} from '@core/pipeline-types';
import {parseReviewToolMessagePayload} from '@core/middleware/review';
import {toError} from '@shared/errors';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {TOOL_NAMES} from '@shared/tool-display';
import {partitionToolCalls} from './tool-concurrency';

export type AgentTurnOutcome = 'continue' | 'complete';

/** Continuation prompts should only be injected once in a row, not on every turn. */
const CONTINUATION_MARKER = 'Continue with the task. If complete, provide a brief summary.';
function shouldTryContinuation(messages: ReadonlyArray<{content?: unknown; _getType?: () => string}>): boolean {
  // Look back through recent messages — if we already pushed a continuation and
  // got ANOTHER empty response, stop (avoid infinite loops).
  let continuations = 0;
  for (let i = messages.length - 1; i >= Math.max(0, messages.length - 10); i--) {
    const msg = messages[i];
    if (msg && typeof msg.content === 'string' && msg.content === CONTINUATION_MARKER) {
      continuations++;
      if (continuations >= 2) return false;
    }
  }
  return true;
}

/** True when an AI message has no visible text and no tool calls — a silent end. */
function isResponseEmpty(response: AIMessage): boolean {
  if (response.tool_calls?.length) return false;
  const content = response.content;
  if (typeof content === 'string') return content.trim().length === 0;
  if (!Array.isArray(content)) return true;
  return !content.some((block: unknown) => {
    if (typeof block === 'string') return block.trim().length > 0;
    if (block && typeof block === 'object' && 'text' in block) {
      const text = (block as {text?: unknown}).text;
      return typeof text === 'string' && text.trim().length > 0;
    }
    return false;
  });
}

// ── Turn entry point ────────────────────────────────────────────────────────

export async function runAgentTurn(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  stream?: AgentStreamWriter,
): Promise<AgentRunSummary> {
  const context = await createTurnContext(run, runtime, turn, `${run.runId}:turn:${turn}`);
  let result: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    throwIfAborted(run.signal);

    const response = await runModel(runtime, context, stream);
    run.state.messages.push(response);
    if (stream) {
      await stream.emitModelUpdate(response);
      await stream.emitValues(run.state.messages);
    }

    await runtime.pipeline.afterModel({...context, response});

    if (!response.tool_calls?.length) {
      // Empty response (no text + no tool_calls): the model stopped mid-task
      // — typically after a tool result. Inject a continuation prompt and
      // let the loop try again (bounded by the max-recursion guard below).
      if (isResponseEmpty(response) && shouldTryContinuation(run.state.messages)) {
        run.state.messages.push(new HumanMessage({
          content: 'Continue with the task. If complete, provide a brief summary.',
        }));
        if (stream) await stream.emitValues(run.state.messages);
        result = {reason: 'continue', turns: turn};
      } else {
        if (isResponseEmpty(response)) {
          response.content = '(model returned no response)';
        }
        result = {reason: 'complete', turns: turn};
      }
    } else {
      throwIfAborted(run.signal);
      const toolOutcome = await runTools(run, runtime, context, response.tool_calls, stream);
      if (toolOutcome.status === 'paused' || toolOutcome.status === 'detached' || run.state.pendingReview) {
        result = {reason: 'complete', turns: turn, launchedSubagentBatchIds: toolOutcome.launchedSubagentBatchIds};
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    result = {reason: 'error', turns: turn, error: toError(error)};
  }

  await finishTurn(runtime, context, result);
  if (result.error) {
    throw result.error;
  }
  return result;
}

// ── Model call ──────────────────────────────────────────────────────────────

async function runModel(
  runtime: AgentRuntime,
  context: ModelCallContext,
  stream?: AgentStreamWriter,
): Promise<AIMessage> {
  return runtime.pipeline.wrapModelCall(context, async (request = context) => {
    const modelMessages = [...request.systemMessage.map((content) => new SystemMessage(content)), ...request.messages];
    if (!stream) {
      return await runtime.model.invoke(modelMessages);
    }

    const execution = readExecutionMetadata(request);
    let aggregate;
    for await (const chunk of runtime.model.stream(modelMessages)) {
      const normalized = toMessageChunk(chunk);
      aggregate = aggregate ? aggregate.concat(normalized) : normalized;
      await stream.emitMessages({
        runId: execution.runId,
        sessionId: execution.sessionId,
        requestId: execution.requestId,
        turn: execution.turn,
        chunk: normalized,
      });
    }

    return aggregate ? chunkToMessage(aggregate) : new AIMessage('');
  });
}

// ── Tool execution orchestration ────────────────────────────────────────────

interface ToolExecutionOutcome {
  status: 'ok' | 'paused' | 'detached';
  launchedSubagentBatchIds: string[];
}

export async function runTools(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[],
  stream?: AgentStreamWriter,
): Promise<ToolExecutionOutcome> {
  const expectedSubagentCount = toolCalls.filter((tc) => tc.name === TOOL_NAMES.AGENT).length;
  const collector = createOutcomeCollector();

  const {readOnly, serial} = partitionToolCalls(toolCalls);

  // Phase 1: Read-only tools run concurrently
  if (readOnly.length > 0) {
    const results = await Promise.all(
      readOnly.map((call) =>
        executeSingleTool(run, runtime, context, toolCalls, call, expectedSubagentCount, stream),
      ),
    );
    for (const result of results) {
      collector.absorb(result);
      if (result.status === 'paused') {
        return collector.finalize();
      }
    }
  }

  // Phase 2: Writable tools run serially
  for (const call of serial) {
    throwIfAborted(run.signal);
    const result = await executeSingleTool(run, runtime, context, toolCalls, call, expectedSubagentCount, stream);
    collector.absorb(result);
    if (result.status === 'paused') {
      return collector.finalize();
    }
  }

  return collector.finalize();
}

// ── Outcome accumulator ─────────────────────────────────────────────────────

function createOutcomeCollector() {
  const batchIds = new Set<string>();
  let sawDetached = false;
  let sawPaused = false;

  return {
    absorb(outcome: ToolExecutionOutcome) {
      for (const id of outcome.launchedSubagentBatchIds) batchIds.add(id);
      if (outcome.status === 'detached') sawDetached = true;
      if (outcome.status === 'paused') sawPaused = true;
    },
    finalize(): ToolExecutionOutcome {
      const status = sawPaused ? 'paused' : sawDetached ? 'detached' : 'ok';
      return {status, launchedSubagentBatchIds: [...batchIds]};
    },
  };
}

// ── Single tool execution ───────────────────────────────────────────────────

async function executeSingleTool(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[],
  toolCall: ToolCall,
  expectedSubagentCount: number,
  stream?: AgentStreamWriter,
): Promise<ToolExecutionOutcome> {
  const toolIndex = toolCalls.indexOf(toolCall);
  const toolCallId = resolveToolCallId(toolCall, toolIndex);
  const tool = runtime.tools.get(toolCall.name);

  // Emit progress: executing
  if (stream) {
    await stream.emitToolProgress({toolCallId, toolName: toolCall.name, status: 'executing'});
  }

  // Execute through middleware pipeline
  const toolMessage = await invokeToolViaPipeline(
    run, runtime, context, toolCall, toolIndex, toolCallId, tool, expectedSubagentCount,
  );

  // Emit progress: completed/failed
  if (stream) {
    await stream.emitToolProgress({
      toolCallId,
      toolName: toolCall.name,
      status: toolMessage.status === 'error' ? 'failed' : 'completed',
    });
  }

  // Commit to state and stream
  run.state.messages.push(toolMessage);
  await emitToolResultToStream(stream, context, toolMessage, run.state.messages);

  // Classify the tool result
  return classifyToolResult(toolMessage, run);
}

// ── Pipeline invocation ─────────────────────────────────────────────────────

async function invokeToolViaPipeline(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCall: ToolCall,
  toolIndex: number,
  toolCallId: string,
  tool: ReturnType<typeof runtime.tools.get>,
  expectedSubagentCount: number,
): Promise<ToolMessage> {
  const baseExecution = {
    ...readExecutionMetadata(context),
    requestId: `${readExecutionMetadata(context).requestId}:tool:${toolCallId}`,
    toolIndex,
    toolCallId,
  };
  const baseRuntime = context.runtime;

  return runtime.pipeline.wrapToolCall({
    ...context,
    execution: baseExecution,
    toolCall,
    toolIndex,
    tool,
  }, (request?: ToolCallContext) => {
    const nextCall = request?.toolCall ?? toolCall;
    const nextIndex = request?.toolIndex ?? toolIndex;
    const nextToolCallId = resolveToolCallId(nextCall, nextIndex);
    const runtimeCarrier = createMutableToolRuntime(request?.runtime ?? baseRuntime, nextIndex, nextToolCallId, baseExecution);

    if (nextCall.name === TOOL_NAMES.AGENT && expectedSubagentCount > 0) {
      runtimeCarrier.runtimeContext = {
        ...(runtimeCarrier.runtimeContext ?? {}),
        codaraSubagentBatch: {
          batchId: createSubagentBatchId(baseExecution),
          expectedCount: expectedSubagentCount,
        },
      };
    }

    return executeToolCall(
      nextCall,
      nextToolCallId,
      request?.tool ?? runtime.tools.get(nextCall.name),
      runtime.handleToolErrors,
      run.state,
      request?.execution ? {...runtimeCarrier, execution: request.execution} : runtimeCarrier,
      (values) => runtime.pipeline.normalizeValues(values ?? {}),
    ).finally(() => {
      syncToolRuntimeBack(baseRuntime, request?.runtime, runtimeCarrier);
    });
  });
}

// ── Stream emission ─────────────────────────────────────────────────────────

async function emitToolResultToStream(
  stream: AgentStreamWriter | undefined,
  context: BaseExecutionContext,
  toolMessage: ToolMessage,
  allMessages: import('@langchain/core/messages').BaseMessage[],
): Promise<void> {
  if (!stream) return;

  await stream.emitToolUpdate(toolMessage);
  await stream.emitValues(allMessages);

  const payload = parseReviewToolMessagePayload(toolMessage.content);
  if (payload) {
    const execution = readExecutionMetadata(context);
    await stream.emitCustom({runId: execution.runId, turn: execution.turn, payload});
  }
}

// ── Result classification ───────────────────────────────────────────────────

function classifyToolResult(
  toolMessage: ToolMessage,
  run: AgentRunContext,
): ToolExecutionOutcome {
  const pausePayload = parseReviewToolMessagePayload(toolMessage.content);
  if (pausePayload?.type === 'review_pause') {
    run.state.pendingReview = pausePayload.request;
    return {status: 'paused', launchedSubagentBatchIds: []};
  }

  const launched = readSubagentRunLaunchResult(toolMessage.artifact);
  if (launched) {
    return {
      status: 'detached',
      launchedSubagentBatchIds: launched.batchId ? [launched.batchId] : [],
    };
  }

  return {status: 'ok', launchedSubagentBatchIds: []};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function createSubagentBatchId(execution: BaseExecutionContext['execution']): string {
  return `${execution.sessionId}:${execution.runId}:turn:${execution.turn}`;
}

function createMutableToolRuntime(
  source: BaseExecutionContext['runtime'],
  toolIndex: number,
  toolCallId: string,
  baseExecution: BaseExecutionContext['execution'],
): BaseExecutionContext['runtime'] & {execution: BaseExecutionContext['execution']} {
  return {
    context: source.context,
    runtimeContext: source.runtimeContext,
    shared: source.shared,
    execution: {...baseExecution, toolIndex, toolCallId},
  };
}

function syncToolRuntimeBack(
  target: BaseExecutionContext['runtime'],
  requestRuntime: BaseExecutionContext['runtime'] | undefined,
  runtimeCarrier: BaseExecutionContext['runtime'] & {execution: BaseExecutionContext['execution']},
): void {
  target.context = runtimeCarrier.context;
  target.runtimeContext = runtimeCarrier.runtimeContext;
  target.shared = runtimeCarrier.shared;

  if (requestRuntime && requestRuntime !== target) {
    requestRuntime.context = runtimeCarrier.context;
    requestRuntime.runtimeContext = runtimeCarrier.runtimeContext;
    requestRuntime.shared = runtimeCarrier.shared;
  }
}

// ── Turn finalization ───────────────────────────────────────────────────────

export async function finishTurn(
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  result: AgentRunSummary,
): Promise<void> {
  try {
    await runtime.pipeline.afterAgent({...context, result});
  } catch (error) {
    if (!result.error) {
      throw toError(error);
    }
  }
}
