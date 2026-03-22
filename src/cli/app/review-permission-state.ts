import type {CliReviewState} from './view-state';
import type {PermissionStage} from './review-types';

/** Read alwaysPatterns from permission review metadata. */
export function readPermissionAlwaysPatterns(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const policy = (metadata as Record<string, unknown>).permissionPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return [];
  const patterns = (policy as Record<string, unknown>).alwaysPatterns;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
}

/** Transition to a permission stage. */
export function setPermissionStage(current: CliReviewState, stage: PermissionStage): CliReviewState {
  if (stage === 'always-confirm') {
    const patterns = current.permissionAlwaysPatterns ?? readPermissionAlwaysPatterns(current.request.metadata);
    return {
      ...current,
      permissionStage: stage,
      permissionAlwaysPatterns: patterns,
    };
  }

  if (stage === 'reject-feedback') {
    return {
      ...current,
      permissionStage: stage,
      draft: '',
    };
  }

  return {
    ...current,
    permissionStage: 'prompt',
  };
}
