import {createReviewMiddleware, type ReviewMiddlewareOptions} from '@core/middleware/review';
import type {BaseMiddleware} from '@core/pipeline/types';
import {
  createPermissionRuntime,
  handlePermissionFallbackResume,
  type PermissionRuntimeOptions,
} from '@core/middleware/permission/runtime';

export interface PermissionMiddlewareOptions extends PermissionRuntimeOptions, ReviewMiddlewareOptions {}

/** @internal Test-only alias for createPermissionMiddleware with direct bashAnalysisModel support. */
export const createPermissionMiddlewareInternal = createPermissionMiddleware;

export function createPermissionMiddleware(
  options: PermissionMiddlewareOptions = {},
): BaseMiddleware {
  const {
    cwd,
    projectRoot,
    userHome,
    policyFiles,
    settingsFile,
    bashAnalysisModel,
    ...reviewOptions
  } = options;

  const permissionRuntime = createPermissionRuntime({
    cwd,
    projectRoot,
    userHome,
    policyFiles,
    settingsFile,
    bashAnalysisModel,
  });
  const fallbackResolveDecision = reviewOptions.resolveDecision;
  const fallbackHandleResume = reviewOptions.handleResume;

  return createReviewMiddleware({
    ...reviewOptions,
    name: reviewOptions.name?.trim() || 'PermissionMiddleware',
    resolveDecision: async (input) => {
      const permissionDecision = await permissionRuntime.resolveToolDecision(input.context);
      if (permissionDecision) {
        return permissionDecision;
      }

      return fallbackResolveDecision ? fallbackResolveDecision(input) : undefined;
    },
    handleResume: async (request, resumePayload, context, handler) => {
      if (permissionRuntime.isPermissionReview(request.metadata)) {
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
