import {createMiddleware} from '@core/middleware';
import type {GuidelinesSource} from '@core/guidelines';
/** 注入由 AGENTS source 提供的 AGENTS.md 投影。 */
export function createGuidelinesMiddleware(guidelinesSource?: GuidelinesSource) {
  return createMiddleware({
    name: 'GuidelinesMiddleware',
    async beforeModel(context) {
      if (!guidelinesSource) {
        return undefined;
      }

      const content = await guidelinesSource.getContent();
      if (!content) {
        return undefined;
      }

      context.systemMessage.push(content);
      return undefined;
    },
  });
}
