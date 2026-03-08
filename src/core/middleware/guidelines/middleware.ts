import {createMiddleware, type ModelCallContext} from '@core/middleware';
import {loadGuidelines, type GuidelinesOptions} from '@core/middleware/guidelines';

/**
 * Guidelines 中间件
 *
 * 对齐 Claude Code 策略：
 * - 加载内容到 system message
 * - 默认 500 行截断保护（可配置）
 * - 超大文件时提示可以查看完整内容
 */
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
