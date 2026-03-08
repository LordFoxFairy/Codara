import {AIMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {ModelCallContext} from '@core/middleware';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {chunkToMessage, toMessageChunk} from '@core/agents/engine/model';
import type {AgentRuntime, AgentRunContext} from '@core/agents/loop/run';

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
    const systemMessages = nextRequest.systemMessage.map((content) => new SystemMessage(content));
    const modelMessages: BaseMessage[] = [...systemMessages, ...nextRequest.messages];
    let aggregate;

    for await (const chunk of runtime.model.stream(modelMessages)) {
      const normalized = toMessageChunk(chunk);
      aggregate = aggregate ? aggregate.concat(normalized) : normalized;
      await stream.emitMessages({runId: run.runId, turn: context.turn, chunk: normalized});
    }

    return aggregate ? chunkToMessage(aggregate) : new AIMessage('');
  };

  return runtime.pipeline.wrapModelCall(context, invoke);
}

async function invokeModel(
  runtime: AgentRuntime,
  context: ModelCallContext,
  request?: ModelCallContext
): Promise<AIMessage> {
  const nextRequest = request ?? context;
  const systemMessages = nextRequest.systemMessage.map((content) => new SystemMessage(content));
  const modelMessages: BaseMessage[] = [...systemMessages, ...nextRequest.messages];
  return runtime.model.invoke(modelMessages);
}
