// src/core/permission/handler.ts

import { HILReviewType, type HILReviewHandler, type HILReviewRequest, type HILReviewResult } from '../hil/types';
import { PermissionRuntime } from './runtime/runtime';
import { generateId, toDirectoryScopeExpression } from './utils';
import { PermissionDeniedError, type ToolCall, type PermissionEvaluationResult } from './types';

export class PermissionReviewHandler implements HILReviewHandler {
  readonly type = HILReviewType.PERMISSION;
  private runtime = new PermissionRuntime();

  buildReviewRequest(
    context: any,
    metadata?: any
  ): HILReviewRequest {
    const { toolCall, evaluation } = context;

    return {
      id: generateId(),
      type: this.type,
      title: `Permission: ${toolCall.tool}`,
      description: `${toolCall.tool}(${toolCall.input})`,
      metadata: {
        toolCall,
        evaluation,
        workingDirectory: process.cwd(),
        actor: { type: 'main' }
      },
      actions: [
        {
          id: 'allow_once',
          label: 'Yes',
          kind: 'primary',
          shortcut: 'y',
          description: 'Allow this operation once'
        },
        {
          id: 'dont_ask_again',
          label: "Yes, don't ask again",
          kind: 'secondary',
          shortcut: 'a',
          description: 'Remember this decision'
        },
        {
          id: 'deny',
          label: 'No',
          kind: 'danger',
          shortcut: 'n',
          description: 'Deny this operation'
        }
      ],
      createdAt: Date.now()
    };
  }

  async handleReviewResult(
    request: HILReviewRequest,
    result: HILReviewResult,
    context: any
  ): Promise<unknown> {
    const { toolCall, evaluation } = request.metadata as { toolCall: ToolCall; evaluation: PermissionEvaluationResult };

    switch (result.actionId) {
      case 'allow_once':
        return this.executeToolCall(toolCall);

      case 'dont_ask_again':
        await this.rememberDecision(toolCall, evaluation);
        return this.executeToolCall(toolCall);

      case 'deny':
        throw new PermissionDeniedError(
          `Permission denied for ${toolCall.tool}(${toolCall.input})`
        );

      default:
        throw new Error(`Unknown action: ${result.actionId}`);
    }
  }

  private async rememberDecision(
    toolCall: ToolCall,
    evaluation: PermissionEvaluationResult
  ): Promise<void> {
    // Edit/Write: 会话级记忆（目录级通配符）
    if (toolCall.tool === 'Edit' || toolCall.tool === 'Write') {
      const dirExpression = toDirectoryScopeExpression(toolCall.tool, toolCall.input);
      this.runtime.addSessionMemory(dirExpression);
    }

    // Bash: 持久化到 settings.local.json
    if (toolCall.tool === 'Bash') {
      const expression = `Bash(${toolCall.input})`;
      await this.runtime.persistBashRule(expression);
    }
  }

  private async executeToolCall(toolCall: ToolCall): Promise<unknown> {
    // 这里应该调用实际的工具执行函数
    // 暂时返回模拟结果
    return { success: true, tool: toolCall.tool, input: toolCall.input };
  }
}
