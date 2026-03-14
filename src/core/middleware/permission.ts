// src/core/middleware/permission.ts

/**
 * Permission Middleware - 基于 HIL 框架的权限管理
 */

import { createHILMiddleware, type HILMiddlewareOptions } from '@core/middleware/hil';
import type { BaseMiddleware } from '@core/middleware/types';
import { PermissionMiddlewareAdapter } from '@core/permission/adapter';

export interface PermissionMiddlewareOptions extends HILMiddlewareOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  policyFiles?: string[];
}

export function createPermissionMiddleware(
  options: PermissionMiddlewareOptions = {}
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
    name: hilOptions.name?.trim() || 'PermissionMiddleware',
    resolveDecision: async (input) => {
      const permissionDecision = await adapter.resolveDecision(input);
      if (permissionDecision) {
        return permissionDecision;
      }

      return fallbackResolveDecision ? fallbackResolveDecision(input) : undefined;
    },
    handleResume: async (request, resumePayload, context, handler) => {
      if (request.metadata?.toolCall && request.metadata?.evaluation) {
        return adapter.handleResume(request, resumePayload, context, handler);
      }

      if (fallbackHandleResume) {
        return fallbackHandleResume(request, resumePayload, context, handler);
      }

      return handler(context);
    },
  });
}
