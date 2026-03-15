// src/cli/components/permission/types.ts

import type {PermissionEvaluationResult} from '@core/middleware/permission/types';

/** Stage of the permission UI flow */
export type PermissionStage = 'prompt' | 'always-confirm' | 'reject-feedback';

/** Props for the main PermissionPanel */
export interface PermissionPanelProps {
  /** Tool name (e.g. 'Bash', 'Edit') */
  toolName: string;
  /** Tool arguments */
  toolArgs: Record<string, unknown>;
  /** Permission evaluation result */
  evaluation: PermissionEvaluationResult;
  /** Suggested "always" patterns for the user to choose from */
  alwaysPatterns?: string[];
  /** Callback when user makes a decision */
  onReply: (reply: PermissionUIReply) => void;
}

/** Reply from the permission UI */
export type PermissionUIReply =
  | { type: 'once' }
  | { type: 'always'; pattern: string }
  | { type: 'reject'; message?: string };
