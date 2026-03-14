// src/core/middleware/permission/middleware-v2.ts

/**
 * 新版 Permission Middleware - 使用重构后的 Permission 系统
 */

import { createHILMiddleware, type HILMiddlewareOptions } from '@core/middleware/hil';
import type { BaseMiddleware } from '@core/middleware/types';
import { PermissionMiddlewareAdapter } from '@core/permission/adapter';

export interface PermissionMiddlewareV2Options extends HILMiddlewareOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  policyFiles?: string[];
}

export function createPermissionMiddlewareV2(
  options: PermissionMiddlewareV2Options = {}
): BaseMiddleware {
  const {
    cwd,
    projectRoot,
    userHome,
    policyFiles,
    ...hilOptions
  } = options;

  const adapter = new PermissionMiddlewareAdapter();
  const fallbackResolveDecision = hilOptions.resolveDecision;
  const fallbackHandleResume = hilOptions.handleResume;

  return createHILMiddleware({
    ...hilOptions,
    name: hilOptions.name?.trim() || 'PermissionMiddlewareV2',
    resolveDecision: async (input) => {
      // 使用新的 Permission 系统
      const permissionDecision = await adapter.resolveDecision(input);
      if (permissionDecision) {
        return permissionDecision;
      }

      // Fallback 到其他决策器
      return fallbackResolveDecision ? fallbackResolveDecision(input) : undefined;
    },
    handleResume: async (request, resumePayload, context, handler) => {
      // 检查是否是 Permission 相关的暂停
      if (request.metadata?.toolCall && request.metadata?.evaluation) {
        return adapter.handleResume(request, resumePayload, context, handler);
      }

      // Fallback 到其他处理器
      if (fallbackHandleResume) {
        return fallbackHandleResume(request, resumePayload, context, handler);
      }

      // 默认：直接执行
      return handler(context);
    },
  });
}
