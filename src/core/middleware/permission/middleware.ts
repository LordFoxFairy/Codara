import {createHILMiddleware, type HILMiddlewareOptions} from '@core/middleware/hil';
import type {BaseMiddleware} from '@core/middleware/types';
import {
  createPermissionRuntime,
  handlePermissionFallbackResume,
  type PermissionRuntimeOptions,
} from '@core/middleware/permission/runtime';

export interface PermissionMiddlewareOptions extends PermissionRuntimeOptions, HILMiddlewareOptions {}

export function createPermissionMiddleware(options: PermissionMiddlewareOptions = {}): BaseMiddleware {
  const {
    cwd,
    projectRoot,
    userHome,
    policyFiles,
    settingsFile,
    includeEditAction,
    bashAnalysisModel,
    analyzeBash,
    ...hilOptions
  } = options;

  const permissionRuntime = createPermissionRuntime({
    cwd,
    projectRoot,
    userHome,
    policyFiles,
    settingsFile,
    includeEditAction,
    bashAnalysisModel,
    analyzeBash,
  });
  const fallbackResolveDecision = hilOptions.resolveDecision;
  const fallbackHandleResume = hilOptions.handleResume;

  return createHILMiddleware({
    ...hilOptions,
    name: hilOptions.name?.trim() || 'PermissionMiddleware',
    resolveDecision: async (input) => {
      const permissionDecision = await permissionRuntime.resolveToolDecision(input.context);
      if (permissionDecision) {
        return permissionDecision;
      }

      return fallbackResolveDecision ? fallbackResolveDecision(input) : undefined;
    },
    handleResume: async (request, resumePayload, context, handler) => {
      if (permissionRuntime.isPermissionPause(request.metadata)) {
        return permissionRuntime.handleResume(request.metadata, resumePayload, context, handler);
      }

      return handlePermissionFallbackResume(
        fallbackHandleResume,
        request,
        resumePayload,
        context,
        handler,
      );
    },
  });
}
