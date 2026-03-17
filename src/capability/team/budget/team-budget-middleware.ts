import {AIMessage} from '@langchain/core/messages';
import {createMiddleware, type BaseMiddleware} from '@engine/pipeline/types';
import type {TeamBudgetTracker, BudgetCheckResult} from './budget-tracker';

export const TEAM_BUDGET_MIDDLEWARE_NAME = 'TeamBudgetMiddleware';

/** Key used in `runtime.shared` to signal that budget is exceeded. */
const BUDGET_EXCEEDED_KEY = '__teamBudgetExceeded';

export interface TeamBudgetMiddlewareOptions {
  tracker: TeamBudgetTracker;
  memberId: string;
  model: string;
  /** Called when budget action is 'warning' or 'exceeded'. */
  onBudgetAction?: (result: BudgetCheckResult) => void;
  /** Called when the member's individual budget is exceeded. */
  onMemberBudgetExceeded?: (memberId: string) => void;
}

/**
 * Middleware that enforces team and per-member budget limits.
 *
 * - `beforeModel`: checks team-level and member-level budgets before each LLM call.
 *   If either is exceeded, stores a flag in `runtime.shared` and fires callbacks.
 * - `wrapModelCall`: if the flag is set, short-circuits the model call with an
 *   AIMessage indicating the budget has been exceeded.
 * - `afterModel`: records actual token usage and re-checks thresholds.
 *
 * Separate from BudgetMiddleware (context-window estimation) —
 * this tracks real cost for team-level budget enforcement.
 */
export function createTeamBudgetMiddleware(options: TeamBudgetMiddlewareOptions): BaseMiddleware {
  const {tracker, memberId, model, onBudgetAction, onMemberBudgetExceeded} = options;

  return createMiddleware({
    name: TEAM_BUDGET_MIDDLEWARE_NAME,

    beforeModel(context) {
      // Check team-level budget
      const teamResult = tracker.checkBudget();
      if (teamResult.action === 'exceeded') {
        if (context.runtime.shared) {
          context.runtime.shared[BUDGET_EXCEEDED_KEY] = 'team';
        }
        onBudgetAction?.(teamResult);
        return;
      }

      // Check member-level budget
      const memberUnderBudget = tracker.checkMemberBudget(memberId);
      if (!memberUnderBudget) {
        if (context.runtime.shared) {
          context.runtime.shared[BUDGET_EXCEEDED_KEY] = 'member';
        }
        const exceededResult: BudgetCheckResult = {
          action: 'exceeded',
          usedPercent: 100,
          remaining: 0,
        };
        onBudgetAction?.(exceededResult);
        onMemberBudgetExceeded?.(memberId);
      }
    },

    wrapModelCall(context, handler) {
      const exceeded = context.runtime.shared?.[BUDGET_EXCEEDED_KEY] as string | undefined;
      if (exceeded) {
        const scope = exceeded === 'team' ? 'Team' : 'Member';
        return Promise.resolve(
          new AIMessage(`[budget] ${scope} budget exceeded. This LLM call has been blocked.`),
        );
      }
      return handler(context);
    },

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
