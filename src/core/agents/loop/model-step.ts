import {AIMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import {readExecutionMetadata, type ModelCallContext} from '@core/middleware';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {chunkToMessage, toMessageChunk} from '@core/agents/engine/runtime';
import type {AgentRuntime, AgentRunContext} from '@core/agents/loop/run';

const CODARA_KEY = 'codara';
const CONTEXT_BUDGET_KEY = 'contextBudget';

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
    const execution = readExecutionMetadata(nextRequest);
    const modelMessages = buildModelMessages(nextRequest.systemMessage, nextRequest.messages);
    let aggregate;

    for await (const chunk of runtime.model.stream(modelMessages)) {
      const normalized = toMessageChunk(chunk);
      aggregate = aggregate ? aggregate.concat(normalized) : normalized;
      await stream.emitMessages({
        runId: execution.runId,
        threadId: execution.threadId,
        requestId: execution.requestId,
        turn: execution.turn,
        chunk: normalized,
      });
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
  const modelMessages = buildModelMessages(nextRequest.systemMessage, nextRequest.messages);
  const response = await runtime.model.invoke(modelMessages);
  return attachContextBudgetMetadata(response, nextRequest.budget);
}

function buildModelMessages(systemMessage: string[], messages: BaseMessage[]): BaseMessage[] {
  const systemMessages = systemMessage.map((content) => new SystemMessage(content));
  return [...systemMessages, ...messages];
}

function attachContextBudgetMetadata(
  message: AIMessage,
  budget: ModelCallContext['budget'] | undefined,
): AIMessage {
  if (!budget) {
    return message;
  }

  const responseMetadata = asRecord(message.response_metadata);
  const codara = asRecord(responseMetadata[CODARA_KEY]);

  return new AIMessage({
    content: message.content,
    ...(message.id ? {id: message.id} : {}),
    ...(message.name ? {name: message.name} : {}),
    ...(message.tool_calls ? {tool_calls: message.tool_calls} : {}),
    ...(message.invalid_tool_calls ? {invalid_tool_calls: message.invalid_tool_calls} : {}),
    ...(message.usage_metadata ? {usage_metadata: message.usage_metadata} : {}),
    ...(message.additional_kwargs ? {additional_kwargs: message.additional_kwargs} : {}),
    response_metadata: {
      ...responseMetadata,
      [CODARA_KEY]: {
        ...codara,
        [CONTEXT_BUDGET_KEY]: budget,
      },
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? {...(value as Record<string, unknown>)}
    : {};
}
