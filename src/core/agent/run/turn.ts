import {AIMessage, SystemMessage, type ToolCall} from '@langchain/core/messages';
import {executeToolCall, resolveToolCallId} from './tool-executor';
import type {AgentStreamWriter} from './stream';
import {
  chunkToMessage,
  createTurnContext,
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
} from '@core/pipeline/types';
import {parseReviewToolMessagePayload} from '@core/middleware/review';
import {toError} from './errors';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {TOOL_NAMES} from '@shared/tool-display';
import {partitionToolCalls} from './tool-concurrency';
import {isToolReadOnly} from '@integration/tool';

export type AgentTurnOutcome = 'continue' | 'complete';

export async function runAgentTurn(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  stream?: AgentStreamWriter,
): Promise<AgentRunSummary> {
  const context = await createTurnContext(run, runtime, turn, `${run.runId}:turn:${turn}`);
  let result: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    const response = await runModel(runtime, context, stream);
    run.state.messages.push(response);
    if (stream) {
      await stream.emitModelUpdate(response);
      await stream.emitValues(run.state.messages);
    }

    await runtime.pipeline.afterModel({...context, response});
    if (!response.tool_calls?.length) {
      result = {reason: 'complete', turns: turn};
    } else {
      const toolOutcome = await runTools(run, runtime, context, response.tool_calls, stream);
      if (toolOutcome.status === 'paused' || run.state.pendingReview) {
        result = {reason: 'complete', turns: turn, launchedSubagentBatchIds: toolOutcome.launchedSubagentBatchIds};
      } else if (toolOutcome.status === 'detached') {
        result = {reason: 'complete', turns: turn, launchedSubagentBatchIds: toolOutcome.launchedSubagentBatchIds};
      }
    }
  } catch (error) {
    result = {reason: 'error', turns: turn, error: toError(error)};
  }

  await finishTurn(runtime, context, result);
  if (result.error) {
    throw result.error;
  }
  return result;
}

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
  const expectedSubagentCount = toolCalls.filter((toolCall) => toolCall.name === TOOL_NAMES.AGENT).length;
  let sawDetached = false;
  const launchedSubagentBatchIds = new Set<string>();

  // Build concurrency registry from the tool calls
  const concurrencyRegistry = new Map<string, {isReadOnly: boolean}>();
  for (const call of toolCalls) {
    if (!concurrencyRegistry.has(call.name)) {
      concurrencyRegistry.set(call.name, {isReadOnly: isToolReadOnly({name: call.name})});
    }
  }

  const {readOnly, serial} = partitionToolCalls(toolCalls, concurrencyRegistry);

  // Phase 1: Read-only tools run concurrently
  if (readOnly.length > 0) {
    const results = await Promise.all(
      readOnly.map((call) => {
        const globalIndex = toolCalls.indexOf(call);
        return runSingleTool(run, runtime, context, toolCalls, globalIndex, expectedSubagentCount, stream);
      }),
    );
    for (const result of results) {
      for (const batchId of result.launchedSubagentBatchIds) {
        launchedSubagentBatchIds.add(batchId);
      }
      if (result.status === 'paused') {
        return {status: 'paused', launchedSubagentBatchIds: [...launchedSubagentBatchIds]};
      }
      if (result.status === 'detached') {
        sawDetached = true;
      }
    }
  }

  // Phase 2: Writable / separable tools run serially
  for (const call of serial) {
    const globalIndex = toolCalls.indexOf(call);
    const result = await runSingleTool(run, runtime, context, toolCalls, globalIndex, expectedSubagentCount, stream);
    for (const batchId of result.launchedSubagentBatchIds) {
      launchedSubagentBatchIds.add(batchId);
    }
    if (result.status === 'paused') {
      return {status: 'paused', launchedSubagentBatchIds: [...launchedSubagentBatchIds]};
    }
    if (result.status === 'detached') {
      sawDetached = true;
    }
  }

  return {
    status: sawDetached ? 'detached' : 'ok',
    launchedSubagentBatchIds: [...launchedSubagentBatchIds],
  };
}

async function runSingleTool(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[],
  toolIndex: number,
  expectedSubagentCount: number,
  stream?: AgentStreamWriter,
): Promise<ToolExecutionOutcome> {
  const toolCall = toolCalls[toolIndex] as ToolCall;
  const toolCallId = resolveToolCallId(toolCall, toolIndex);
  const tool = runtime.tools.get(toolCall.name);
  const baseExecution = {
    ...readExecutionMetadata(context),
    requestId: `${readExecutionMetadata(context).requestId}:tool:${toolCallId}`,
    toolIndex,
    toolCallId,
  };

  if (stream) {
    await stream.emitToolProgress({toolCallId, toolName: toolCall.name, status: 'executing'});
  }

  const baseRuntime = requestRuntime(context);
  const toolMessage = await runtime.pipeline.wrapToolCall({
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

  if (stream) {
    await stream.emitToolProgress({
      toolCallId,
      toolName: toolCall.name,
      status: toolMessage.status === 'error' ? 'failed' : 'completed',
    });
  }

  run.state.messages.push(toolMessage);
  if (stream) {
    await stream.emitToolUpdate(toolMessage);
    await stream.emitValues(run.state.messages);
    const payload = parseReviewToolMessagePayload(toolMessage.content);
    if (payload) {
      const execution = readExecutionMetadata(context);
      await stream.emitCustom({runId: execution.runId, turn: execution.turn, payload});
    }
  }

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

function createSubagentBatchId(execution: BaseExecutionContext['execution']): string {
  return `${execution.sessionId}:${execution.runId}:turn:${execution.turn}`;
}

function requestRuntime(context: BaseExecutionContext): BaseExecutionContext['runtime'] {
  return context.runtime;
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
