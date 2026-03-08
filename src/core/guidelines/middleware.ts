import {createMiddleware, type ModelCallContext} from '@core/middleware';
import {loadAgentsGuidelines} from '@core/guidelines/loader';
import type {AgentsGuidelinesOptions} from '@core/guidelines/types';

/** 将 AGENTS.md 规范注入模型调用系统消息。 */
export function createAgentsGuidelinesMiddleware(options: AgentsGuidelinesOptions = {}) {
  return createMiddleware({
    name: 'AgentsGuidelinesMiddleware',

    async wrapModelCall(context: ModelCallContext, handler) {
      const guidelines = await loadAgentsGuidelines(options);
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
