import {type ToolCall, ToolMessage} from '@langchain/core/messages';
import {ToolInputParsingException, type StructuredToolInterface} from '@langchain/core/tools';
import {ToolInvocationError} from 'langchain';
import type {ToolErrorHandler} from '@core/agents/contract/agent';

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
  handleToolErrors: ToolErrorHandler
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
    const result = await tool.invoke(toolCall.args);
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
