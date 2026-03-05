import {type ToolCall, ToolMessage} from '@langchain/core/messages';
import {ToolInputParsingException, type StructuredToolInterface} from '@langchain/core/tools';
import {ToolInvocationError} from 'langchain';
import {toError} from '@core/agents/runtime/shared/common';
import type {ToolErrorHandler} from '@core/agents/types';

/**
 * 工具核心执行器（不含 middleware）。
 * middleware 包裹在 turn-stage 的 wrapToolCall 中，便于主链路阅读。
 */
export async function invokeTool(
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
    const content = String(await tool.invoke(toolCall.args));
    return new ToolMessage({content, tool_call_id: toolCallId});
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
