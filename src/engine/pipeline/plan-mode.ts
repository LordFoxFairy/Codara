/**
 * PlanModeMiddleware — plan 模式下阻止写操作。
 *
 * 通过 middleware pipeline 实现：
 * - beforeModel: 注入系统提示，告知模型当前处于 plan 模式
 * - wrapToolCall: 拦截 write_file / edit_file，返回描述性错误
 */

import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, type BaseMiddleware} from '@engine/pipeline/types';

export type CodaraMode = 'normal' | 'plan' | 'auto';

const PLAN_MODE_WRITE_TOOLS = new Set(['write_file', 'edit_file']);

export function createPlanModeMiddleware(): BaseMiddleware {
  return createMiddleware({
    name: 'PlanModeMiddleware',

    async beforeModel(context) {
      context.systemMessage.push(
        'You are in PLAN mode. Analyze, design, and create plans — do NOT execute changes. ' +
        'If you attempt to write or edit files, your request will be blocked. ' +
        'Use read, search, and exploration tools freely.'
      );
      return undefined;
    },

    async wrapToolCall(context, handler) {
      if (PLAN_MODE_WRITE_TOOLS.has(context.toolCall.name)) {
        return new ToolMessage({
          content: `Blocked: "${context.toolCall.name}" is not allowed in plan mode. Use plan mode for analysis and design only.`,
          tool_call_id: context.toolCall.id ?? '',
          status: 'error',
        });
      }
      return handler(context);
    },
  });
}

/** 判断当前模式是否允许写操作。 */
export function isModeWriteAllowed(mode: CodaraMode): boolean {
  return mode !== 'plan';
}
