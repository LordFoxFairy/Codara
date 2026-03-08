import {createMiddleware, type ModelCallContext} from '@core/middleware';
import type {GuidelinesStore} from '@core/middleware/guidelines/store';

/** 将 AGENTS.md 规范注入模型调用系统消息。 */
export function createGuidelinesMiddleware() {
  return createMiddleware({
    name: 'GuidelinesMiddleware',

    async wrapModelCall(context: ModelCallContext, handler) {
      // 从 AgentRuntimeContext 读取 Guidelines Store 实例
      const guidelinesStore = context.runtime.context.__codaraGuidelines as GuidelinesStore | undefined;

      if (!guidelinesStore) {
        return handler(context);
      }

      const guidelines = await guidelinesStore.load();
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
