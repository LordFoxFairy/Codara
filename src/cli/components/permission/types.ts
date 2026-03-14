// src/cli/components/permission/types.ts

import type { ToolCall, PermissionEvaluationResult } from '@core/middleware/permission/types';

export interface PermissionViewProps {
  toolCall: ToolCall;
  evaluation: PermissionEvaluationResult;
  onAction: (actionId: string) => void;
}

export interface BashAnalysisResult {
  command: string;
  normalized: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  operations: string[];
  complexity: {
    hasSubshell: boolean;
    hasPipe: boolean;
    hasRedirect: boolean;
  };
}
