import {createMiddleware} from '@core/middleware';
import type {CodaraMemory} from '@core/codara/memory';

/** 将 MEMORY.md 记忆注入模型调用系统消息。 */
export function createMemoryMiddleware() {
  return createMiddleware({
    name: 'MemoryMiddleware',

    async wrapModelCall(context, handler) {
      // 从 AgentRuntimeContext 读取 Memory Store 实例
      const memoryStore = context.runtime.context.__codaraMemory as CodaraMemory | undefined;

      if (!memoryStore) {
        return handler(context);
      }

      const globalContent = await memoryStore.read('global');
      const projectContent = await memoryStore.read('project');
      const content = [globalContent, projectContent].filter(Boolean).join('\n\n');

      if (!content) {
        return handler(context);
      }

      return handler({
        ...context,
        systemMessage: context.systemMessage.concat(content),
      });
    },
  });
}
