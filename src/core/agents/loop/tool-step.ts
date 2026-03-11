import type {ToolCall} from '@langchain/core/messages';
import type {AgentRunSummary, BaseExecutionContext, ToolCallContext} from '@core/middleware';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {executeToolCall, resolveToolCallId} from '@core/agents/engine/tools';
import {readLatestPause} from '@core/agents/engine/runtime-input';
import type {AgentRuntime, AgentRunContext} from '@core/agents/loop/run';
import {readToolExecutionPolicy} from '@core/tools';
import {toError} from '@core/shared/errors';

export async function runToolStep(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[]
): Promise<void> {
  for (const batch of createToolExecutionBatches(runtime, toolCalls)) {
    const results = await Promise.all(batch.map((entry) => executeWrappedToolCall(run, runtime, context, entry)));
    for (const {toolMessage} of results) {
      run.state.messages.push(toolMessage);
    }
    if (stopToolExecutionAfterPause(run, results.map(({toolMessage}) => toolMessage))) {
      return;
    }
  }
}

export async function runToolStepStream(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[],
  stream: AgentStreamWriter
): Promise<void> {
  for (const batch of createToolExecutionBatches(runtime, toolCalls)) {
    const results = await Promise.all(batch.map((entry) => executeWrappedToolCall(run, runtime, context, entry)));
    for (const {toolMessage} of results) {
      run.state.messages.push(toolMessage);
      await stream.emitToolUpdate(toolMessage);
      await stream.emitValues(run.state.messages);

      const payload = parseHILToolMessagePayload(toolMessage.content);
      if (payload) {
        await stream.emitCustom({runId: context.runId, turn: context.turn, payload});
      }
    }
    if (stopToolExecutionAfterPause(run, results.map(({toolMessage}) => toolMessage))) {
      return;
    }
  }
}

export async function runAfterAgentStep(
  pipeline: AgentRuntime['pipeline'],
  context: BaseExecutionContext,
  result: AgentRunSummary
): Promise<void> {
  try {
    await pipeline.afterAgent({...context, result});
  } catch (error) {
    if (!result.error) {
      throw toError(error);
    }
  }
}

function createToolContext(
  context: BaseExecutionContext,
  toolCall: ToolCall,
  toolIndex: number,
  toolCallId: string,
  tool: ToolCallContext['tool']
): ToolCallContext {
  return {
    ...context,
    requestId: `${context.requestId}:tool:${toolCallId}`,
    toolCall,
    toolIndex,
    tool,
  };
}

interface ToolExecutionEntry {
  toolCall: ToolCall;
  toolIndex: number;
}

async function executeWrappedToolCall(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  entry: ToolExecutionEntry,
): Promise<{toolMessage: Awaited<ReturnType<typeof executeToolCall>>}> {
  const {toolCall, toolIndex} = entry;
  const pipeline = runtime.pipeline;
  const toolCallId = resolveToolCallId(toolCall, toolIndex);
  const tool = runtime.tools.get(toolCall.name);
  const toolContext = createToolContext(context, toolCall, toolIndex, toolCallId, tool);

  const toolMessage = await pipeline.wrapToolCall(toolContext, (request?: ToolCallContext) => {
    const nextCall = request?.toolCall ?? toolCall;
    const nextIndex = request?.toolIndex ?? toolIndex;
    const nextTool = request?.tool ?? runtime.tools.get(nextCall.name);
    const nextToolCallId = resolveToolCallId(nextCall, nextIndex);
    return executeToolCall(
      nextCall,
      nextToolCallId,
      nextTool,
      runtime.handleToolErrors,
      run.state,
      {
        ...(request?.runtime ?? context.runtime),
        runId: request?.runId ?? context.runId,
        turn: request?.turn ?? context.turn,
        requestId: request?.requestId ?? context.requestId,
        toolIndex: nextIndex,
      },
      (values) => runtime.pipeline.normalizeValues(values ?? {})
    );
  });

  return {toolMessage};
}

function createToolExecutionBatches(
  runtime: AgentRuntime,
  toolCalls: ToolCall[],
): ToolExecutionEntry[][] {
  const batches: ToolExecutionEntry[][] = [];
  let pendingParallel: ToolExecutionEntry[] = [];

  const flushParallel = () => {
    if (pendingParallel.length > 0) {
      batches.push(pendingParallel);
      pendingParallel = [];
    }
  };

  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
    const toolCall = toolCalls[toolIndex];
    const tool = runtime.tools.get(toolCall.name);
    const policy = readToolExecutionPolicy(tool);
    const entry = {toolCall, toolIndex};

    if (policy === 'parallel_safe') {
      pendingParallel.push(entry);
      continue;
    }

    flushParallel();
    batches.push([entry]);
  }

  flushParallel();
  return batches;
}

function stopToolExecutionAfterPause(
  run: AgentRunContext,
  batchMessages: Awaited<ReturnType<typeof executeToolCall>>[],
): boolean {
  const pause = readLatestPause(batchMessages);
  if (!pause) {
    return false;
  }

  run.state.pendingPause = pause;
  return true;
}
