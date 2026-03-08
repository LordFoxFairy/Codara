import {createMiddleware} from '@core/middleware';
import type {CodaraMemory} from '@core/codara/memory';

/**
 * Memory 中间件
 *
 * 对齐 Claude Code 策略：
 * - 加载内容到 system message
 * - 默认 200 行截断保护（在 store 层实现）
 * - 超大文件时提示可以查看完整内容
 */
export function createMemoryMiddleware() {
  return createMiddleware({
    name: 'MemoryMiddleware',

    async wrapModelCall(context, handler) {
      const memoryStore = context.runtime.context.__codaraMemory as CodaraMemory | undefined;

      if (!memoryStore) {
        return handler(context);
      }

      // 加载内容（store 层已有 200 行截断保护）
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
