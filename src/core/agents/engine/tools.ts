import {type BaseMessage, type ToolCall, ToolMessage} from '@langchain/core/messages';
import {ToolInputParsingException, type StructuredToolInterface} from '@langchain/core/tools';
import {ToolInvocationError} from 'langchain';
import {Command, isCommand, applyAgentStateUpdate} from '@core/agents/command';
import type {AgentState, ToolErrorHandler} from '@core/agents/contract/agent';
import type {ExecutionContextMetadata} from '@core/middleware/types';
import {readToolExecutionPolicy} from '@core/tools';

export function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const existingId = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  if (existingId) {
    return existingId;
  }

  const safeToolName = toolCall.name?.trim() || 'tool';
  return `${safeToolName}_${toolIndex}`;
}

/** 在中间件包装之外执行一次工具调用。 */
export async function executeToolCall(
  toolCall: ToolCall,
  toolCallId: string,
  tool: StructuredToolInterface | undefined,
  handleToolErrors: ToolErrorHandler,
  state: Pick<AgentState, 'threadId' | 'agentType' | 'messages' | 'context' | 'values'>,
  runtime?: {
    context: AgentState['context'];
    runtimeContext?: AgentState['context'];
    shared?: Record<string, unknown>;
    execution: ExecutionContextMetadata;
  },
  normalizeValues?: (values: AgentState['values']) => AgentState['values']
): Promise<ToolMessage> {
  if (!tool) {
    return handleToolError(
      new Error(`Tool "${toolCall.name}" not found`),
      toolCall,
      toolCallId,
      handleToolErrors
    );
  }

  try {
    const executionPolicy = readToolExecutionPolicy(tool);
    const execution = runtime?.execution ?? {
      threadId: state.threadId,
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
        context: runtime?.context ?? state.context,
        runtimeContext: runtime?.runtimeContext ?? {},
        runtimeShared: runtime?.shared ?? {},
      },
      metadata: {
        agentType: state.agentType,
        execution,
      },
    });
    if (ToolMessage.isInstance(result)) {
      const toolMessage = result.tool_call_id ? result : new ToolMessage({
        content: result.content,
        artifact: result.artifact,
        status: result.status,
        tool_call_id: toolCallId,
      });

      const artifactCommand = readCommandArtifact(toolMessage.artifact);
      if (artifactCommand) {
        if (executionPolicy === 'parallel_safe') {
          return createParallelMutationError(toolCallId, toolCall.name);
        }
        return applyToolCommand(artifactCommand, toolCallId, state, runtime, normalizeValues, toolMessage);
      }

      return toolMessage;
    }
    if (isCommand(result)) {
      if (executionPolicy === 'parallel_safe') {
        return createParallelMutationError(toolCallId, toolCall.name);
      }
      return applyToolCommand(result, toolCallId, state, runtime, normalizeValues);
    }
    const content = String(result);

    // 使用 artifact 存储原始结果（对齐 LangChain 标准）
    // content 是字符串化的结果，artifact 保留原始结构
    return new ToolMessage({
      content,
      tool_call_id: toolCallId,
      artifact: result,
    });
  } catch (error) {
    return handleToolError(error, toolCall, toolCallId, handleToolErrors);
  }
}

function normalizeToolError(error: unknown, toolCall: ToolCall): unknown {
  if (error instanceof ToolInputParsingException) {
    return new ToolInvocationError(error, toolCall);
  }

  return error;
}

async function handleToolError(
  error: unknown,
  toolCall: ToolCall,
  toolCallId: string,
  handleToolErrors: ToolErrorHandler
): Promise<ToolMessage> {
  const toolError = normalizeToolError(error, toolCall);
  const message = toError(toolError).message;

  if (!handleToolErrors) {
    throw new Error(`Tool "${toolCall.name}" execution failed: ${message}`);
  }

  if (typeof handleToolErrors === 'function') {
    const handled = await handleToolErrors(toolError, toolCall);
    if (handled && ToolMessage.isInstance(handled)) {
      return handled;
    }

    throw toError(toolError);
  }

  return createToolError(toolCallId, `Tool execution failed: ${message}`);
}

function createToolError(toolCallId: string, content: string): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: toolCallId,
    status: 'error'
  });
}

function createParallelMutationError(toolCallId: string, toolName: string): ToolMessage {
  return createToolError(
    toolCallId,
    `Tool "${toolName}" is marked parallel_safe and cannot mutate runtime state`
  );
}

function applyToolCommand(
  command: Command,
  toolCallId: string,
  state: Pick<AgentState, 'threadId' | 'agentType' | 'messages' | 'context' | 'values'>,
  runtime?: {
    context: AgentState['context'];
    shared?: Record<string, unknown>;
    runtimeContext?: AgentState['context'];
    execution: ExecutionContextMetadata;
  },
  normalizeValues?: (values: AgentState['values']) => AgentState['values'],
  fallbackToolMessage?: ToolMessage
): ToolMessage {
  const commandMessages = normalizeCommandMessages(command.update.messages, toolCallId);
  const toolMessage = findCommandToolMessage(commandMessages, toolCallId);
  const extraMessages = toolMessage ? commandMessages.filter((message) => message !== toolMessage) : commandMessages;

  applyAgentStateUpdate(state, {
    ...command.update,
    messages: extraMessages,
  }, runtime);

  if (command.update.values && normalizeValues) {
    state.values = normalizeValues(state.values ?? {});
  }

  return toolMessage ?? fallbackToolMessage ?? new ToolMessage({
    content: 'Command applied.',
    tool_call_id: toolCallId,
  });
}

function readCommandArtifact(value: unknown): Command | undefined {
  return isCommand(value) ? value : undefined;
}

function normalizeCommandMessages(messages: BaseMessage[] | undefined, toolCallId: string): BaseMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    if (!ToolMessage.isInstance(message) || message.tool_call_id) {
      return message;
    }

    return new ToolMessage({
      content: message.content,
      artifact: message.artifact,
      status: message.status,
      tool_call_id: toolCallId,
    });
  });
}

function findCommandToolMessage(messages: BaseMessage[], toolCallId: string): ToolMessage | undefined {
  return messages.find((message) => (
    ToolMessage.isInstance(message) && message.tool_call_id === toolCallId
  )) as ToolMessage | undefined;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
