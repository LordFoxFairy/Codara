import {createMiddleware, type ModelCallContext} from '@core/middleware';
import {loadGuidelines} from '@core/guidelines/loader';
import type {GuidelinesOptions} from '@core/guidelines/types';

/** 将 AGENTS.md 规范注入模型调用系统消息。 */
export function createGuidelinesMiddleware(options: GuidelinesOptions = {}) {
  return createMiddleware({
    name: 'GuidelinesMiddleware',

    async wrapModelCall(context: ModelCallContext, handler) {
      const guidelines = await loadGuidelines(options);
      if (!guidelines) {
        return handler(context);
      }

      return handler({
        ...context,
        systemMessage: context.systemMessage.concat(guidelines.content),
      });
    },
  });
}
