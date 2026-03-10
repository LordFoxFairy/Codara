import {createMiddleware} from '@core/middleware';
import type {AgentsSource} from '@core/sessions/agents';
/** 注入由 AGENTS source 提供的 AGENTS.md 投影。 */
export function createGuidelinesMiddleware(agentsSource?: AgentsSource) {
  return createMiddleware({
    name: 'GuidelinesMiddleware',
    async beforeModel(context) {
      if (!agentsSource) {
        return undefined;
      }

      const content = await agentsSource.getContent();
      if (!content) {
        return undefined;
      }

      context.systemMessage.push(content);
      return undefined;
    },
  });
}
