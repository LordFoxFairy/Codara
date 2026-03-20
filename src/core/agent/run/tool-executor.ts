import {type BaseMessage, type ToolCall, ToolMessage} from '@langchain/core/messages';
import {ToolInputParsingException, type StructuredToolInterface} from '@langchain/core/tools';
import {ToolInvocationError} from 'langchain';
import {Command, applyAgentStateUpdate, isCommand, mergeContext} from '../models/command';
import type {AgentState, ToolErrorHandler} from '../models/agent';
import type {ExecutionContextMetadata} from '@core/pipeline/types';

export function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  return id || `${toolCall.name?.trim() || 'tool'}_${toolIndex}`;
}

export async function executeToolCall(
  toolCall: ToolCall,
  toolCallId: string,
  tool: StructuredToolInterface | undefined,
  handleToolErrors: ToolErrorHandler,
  state: Pick<AgentState, 'sessionId' | 'agentType' | 'messages' | 'context' | 'values'>,
  runtime?: {
    context: AgentState['context'];
    runtimeContext?: AgentState['context'];
    shared?: Record<string, unknown>;
    execution: ExecutionContextMetadata;
  },
  normalizeValues?: (values: AgentState['values']) => AgentState['values'],
): Promise<ToolMessage> {
  if (!tool) {
    return handleToolFailure(new Error(`Tool "${toolCall.name}" not found`), toolCall, toolCallId, handleToolErrors);
  }

  try {
    const execution = runtime?.execution ?? {
      sessionId: state.sessionId,
      runId: '',
      turn: 0,
      maxTurns: 0,
      requestId: '',
      toolCallId,
    };
    const result = await tool.invoke(toolCall.args, {
      toolCall,
      configurable: {
        execution,
        agentType: state.agentType,
        durableContext: state.context,
        context: mergeContext(state.context ?? {}, runtime?.runtimeContext),
        runtimeContext: runtime?.runtimeContext ?? {},
        runtimeShared: runtime?.shared ?? {},
      },
      metadata: {agentType: state.agentType, execution},
    });

    if (ToolMessage.isInstance(result)) {
      const toolMessage = result.tool_call_id ? result : new ToolMessage({
        content: result.content,
        artifact: result.artifact,
        status: result.status,
        tool_call_id: toolCallId,
      });
      const command = isCommand(toolMessage.artifact) ? toolMessage.artifact : undefined;
      return command ? applyToolCommand(command, toolCallId, state, runtime, normalizeValues, toolMessage) : toolMessage;
    }

    if (isCommand(result)) {
      return applyToolCommand(result, toolCallId, state, runtime, normalizeValues);
    }

    return new ToolMessage({content: String(result), tool_call_id: toolCallId, artifact: result});
  } catch (error) {
    return handleToolFailure(error, toolCall, toolCallId, handleToolErrors);
  }
}

async function handleToolFailure(
  error: unknown,
  toolCall: ToolCall,
  toolCallId: string,
  handleToolErrors: ToolErrorHandler,
): Promise<ToolMessage> {
  const cause = error instanceof ToolInputParsingException ? new ToolInvocationError(error, toolCall) : toError(error);
  if (!handleToolErrors) {
    throw new Error(`Tool "${toolCall.name}" execution failed: ${cause.message}`);
  }

  if (typeof handleToolErrors === 'function') {
    const handled = await handleToolErrors(cause, toolCall);
    if (handled && ToolMessage.isInstance(handled)) {
      return handled;
    }

    throw cause;
  }

  return new ToolMessage({content: `Tool execution failed: ${cause.message}`, tool_call_id: toolCallId, status: 'error'});
}

function applyToolCommand(
  command: Command,
  toolCallId: string,
  state: Pick<AgentState, 'sessionId' | 'agentType' | 'messages' | 'context' | 'values'>,
  runtime?: {
    context: AgentState['context'];
    runtimeContext?: AgentState['context'];
    shared?: Record<string, unknown>;
    execution: ExecutionContextMetadata;
  },
  normalizeValues?: (values: AgentState['values']) => AgentState['values'],
  fallback?: ToolMessage,
): ToolMessage {
  const messages = normalizeCommandMessages(command.update.messages, toolCallId);
  const toolMessage = messages.find(
    (message): message is ToolMessage => ToolMessage.isInstance(message) && message.tool_call_id === toolCallId,
  );

  applyAgentStateUpdate(state, {
    ...command.update,
    messages: toolMessage ? messages.filter((message) => message !== toolMessage) : messages,
  }, runtime);

  if (command.update.values && normalizeValues) {
    state.values = normalizeValues(state.values ?? {});
  }

  return toolMessage ?? fallback ?? new ToolMessage({content: 'Command applied.', tool_call_id: toolCallId});
}

function normalizeCommandMessages(messages: BaseMessage[] | undefined, toolCallId: string): BaseMessage[] {
  return Array.isArray(messages)
    ? messages.map((message) => (
      ToolMessage.isInstance(message) && !message.tool_call_id
        ? new ToolMessage({
          content: message.content,
          artifact: message.artifact,
          status: message.status,
          tool_call_id: toolCallId,
        })
        : message
    ))
    : [];
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
