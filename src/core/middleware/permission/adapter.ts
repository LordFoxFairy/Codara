// src/core/permission/adapter.ts

/**
 * 适配器：将新的 Permission 系统桥接到现有的 HIL middleware 架构
 */

import { PermissionRuntime } from './runtime/runtime';
import { PermissionReviewHandler } from './handler';
import type { ToolCall as LangChainToolCall } from '@langchain/core/messages';
import type { ToolCallContext } from '@core/middleware/types';
import type { HILDecision, HILDecisionContext } from '@core/middleware/hil';
import type { ToolCall, PermissionEvaluationResult } from './types';

export class PermissionMiddlewareAdapter {
  private runtime: PermissionRuntime;
  private handler: PermissionReviewHandler;

  constructor() {
    this.runtime = new PermissionRuntime();
    this.handler = new PermissionReviewHandler();
  }

  /**
   * 将 LangChain ToolCall 转换为我们的 ToolCall 格式
   */
  private convertToolCall(langChainToolCall: LangChainToolCall): ToolCall {
    return {
      tool: langChainToolCall.name,
      input: typeof langChainToolCall.args === 'string'
        ? langChainToolCall.args
        : JSON.stringify(langChainToolCall.args),
      args: typeof langChainToolCall.args === 'object' ? [langChainToolCall.args] : undefined
    };
  }

  /**
   * 解析权限决策
   */
  async resolveDecision(input: HILDecisionContext): Promise<HILDecision | undefined> {
    const { context } = input;
    const toolCall = this.convertToolCall(context.toolCall);

    try {
      // 1. 解析权限决策
      const evaluation = await this.runtime.resolveDecision(toolCall, {
        projectRoot: context.runtime.projectRoot,
        userHome: context.runtime.userHome,
        policyFiles: []
      });

      // 2. 根据决策返回相应的 HIL 决策
      switch (evaluation.decision) {
        case 'allow':
          return { decision: 'allow' };

        case 'deny':
          return {
            decision: 'deny',
            reason: `Permission denied for ${toolCall.tool}`,
            metadata: { evaluation }
          };

        case 'ask':
          return {
            decision: 'ask',
            metadata: { toolCall, evaluation },
            config: {
              description: `Permission required: ${toolCall.tool}(${toolCall.input})`,
              metadata: { toolCall, evaluation }
            }
          };

        default:
          return undefined;
      }
    } catch (error) {
      console.error('Permission decision error:', error);
      return undefined;
    }
  }

  /**
   * 处理用户恢复决策
   */
  async handleResume(
    request: any,
    resumePayload: any,
    context: ToolCallContext,
    handler: (request?: ToolCallContext) => Promise<any>
  ): Promise<any> {
    const { toolCall, evaluation } = request.metadata as {
      toolCall: ToolCall;
      evaluation: PermissionEvaluationResult;
    };

    // 根据用户的决策处理
    const action = resumePayload.action || resumePayload.decision;

    if (action === 'approve' || action === 'allow_once') {
      // 允许一次
      return handler(context);
    }

    if (action === 'dont_ask_again') {
      // 记住决策
      if (toolCall.tool === 'Edit' || toolCall.tool === 'Write') {
        const dirExpression = this.toDirectoryScopeExpression(toolCall.tool, toolCall.input);
        this.runtime.addSessionMemory(dirExpression);
      } else if (toolCall.tool === 'Bash') {
        const expression = `Bash(${toolCall.input})`;
        await this.runtime.persistBashRule(expression);
      }
      return handler(context);
    }

    if (action === 'reject' || action === 'deny') {
      // 拒绝
      throw new Error(`Permission denied for ${toolCall.tool}(${toolCall.input})`);
    }

    // 默认：允许执行
    return handler(context);
  }

  private toDirectoryScopeExpression(tool: string, filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) {
      return `${tool}(*)`;
    }
    const directory = normalized.substring(0, lastSlash + 1);
    return `${tool}(${directory}*)`;
  }
}
