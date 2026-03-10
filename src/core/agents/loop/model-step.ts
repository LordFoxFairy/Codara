import {AIMessage} from '@langchain/core/messages';
import type {ModelCallContext} from '@core/middleware';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {chunkToMessage, toMessageChunk} from '@core/agents/engine/model';
import type {AgentRuntime, AgentRunContext} from '@core/agents/loop/run';
import {buildConversationMessages} from '@core/middleware/conversation-input';
import {attachContextBudgetMetadata} from '@core/sessions/telemetry';

export async function runModelStep(
  runtime: AgentRuntime,
  context: ModelCallContext
): Promise<AIMessage> {
  return runtime.pipeline.wrapModelCall(context, (request?: ModelCallContext) =>
    invokeModel(runtime, context, request)
  );
}

export async function runModelStepStream(
  runtime: AgentRuntime,
  run: AgentRunContext,
  context: ModelCallContext,
  stream: AgentStreamWriter
): Promise<AIMessage> {
  const invoke = async (request?: ModelCallContext) => {
    const nextRequest = request ?? context;
    const {modelMessages} = buildConversationMessages(nextRequest);
    let aggregate;

    for await (const chunk of runtime.model.stream(modelMessages)) {
      const normalized = toMessageChunk(chunk);
      aggregate = aggregate ? aggregate.concat(normalized) : normalized;
      await stream.emitMessages({runId: run.runId, turn: context.turn, chunk: normalized});
    }

    const message = aggregate ? chunkToMessage(aggregate) : new AIMessage('');
    return attachContextBudgetMetadata(message, nextRequest.budget);
  };

  return runtime.pipeline.wrapModelCall(context, invoke);
}

async function invokeModel(
  runtime: AgentRuntime,
  context: ModelCallContext,
  request?: ModelCallContext
): Promise<AIMessage> {
  const nextRequest = request ?? context;
  const {modelMessages} = buildConversationMessages(nextRequest);
  const response = await runtime.model.invoke(modelMessages);
  return attachContextBudgetMetadata(response, nextRequest.budget);
}
