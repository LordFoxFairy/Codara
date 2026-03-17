import {createMiddleware, type BaseMiddleware} from '@engine/pipeline/types';
import type {TeamBudgetTracker, BudgetCheckResult} from './budget-tracker';

export const TEAM_BUDGET_MIDDLEWARE_NAME = 'TeamBudgetMiddleware';

export interface TeamBudgetMiddlewareOptions {
  tracker: TeamBudgetTracker;
  memberId: string;
  model: string;
  /** Called when budget action is 'warning' or 'exceeded'. */
  onBudgetAction?: (result: BudgetCheckResult) => void;
}

/**
 * Middleware that records actual LLM token usage to the team's
 * budget tracker after each model call.
 *
 * Separate from BudgetMiddleware (context-window estimation) —
 * this tracks real cost for team-level budget enforcement.
 */
export function createTeamBudgetMiddleware(options: TeamBudgetMiddlewareOptions): BaseMiddleware {
  const {tracker, memberId, model, onBudgetAction} = options;

  return createMiddleware({
    name: TEAM_BUDGET_MIDDLEWARE_NAME,
    async afterModel(context) {
      const usage = context.response.usage_metadata as
        | {input_tokens?: number; output_tokens?: number}
        | undefined;

      if (!usage) return;

      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      if (input === 0 && output === 0) return;

      const result = tracker.recordUsage(memberId, model, input, output);

      if (result.action !== 'none' && onBudgetAction) {
        onBudgetAction(result);
      }
    },
  });
}
