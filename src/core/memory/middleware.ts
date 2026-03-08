import {createMiddleware} from '@core/middleware';
import {loadMemory} from '@core/memory/loader';
import type {MemoryOptions} from '@core/memory/types';

/** 将 MEMORY.md 记忆注入模型调用系统消息。 */
export function createMemoryMiddleware(options: MemoryOptions = {}) {
  return createMiddleware({
    name: 'MemoryMiddleware',

    async wrapModelCall(context, handler) {
      const memory = await loadMemory(options);
      if (!memory) {
        return handler(context);
      }

      return handler({
        ...context,
        systemMessage: context.systemMessage.concat(memory.content),
      });
    },
  });
}
