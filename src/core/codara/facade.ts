import {createSession} from '@core/sessions';
import {createCodaraSourceProvider} from '@core/sessions/source-provider';
import {createCodaraModelCatalog} from '@core/codara/models';
import {createCodaraTools} from '@core/codara/tools';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import type {Codara, CodaraOptions} from '@core/codara/types';

/**
 * 创建 Codara 实例。
 *
 * 对外 API 设计对齐 Claude Code：
 * - 使用 alias（'default' / 'sonnet' / 'fast'）而不是暴露 provider:model
 * - 简洁、产品化、不暴露内部实现细节
 *
 * @example
 * ```ts
 * // 使用默认 model
 * const codara = createCodara();
 *
 * // 使用具名 alias
 * const codara = createCodara({alias: 'sonnet'});
 *
 * // 高级用法：直接传 model 实例
 * const codara = createCodara({model: customChatModel});
 * ```
 */
export function createCodara(options: CodaraOptions = {}): Codara {
  const sourceProvider = createCodaraSourceProvider({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
    guidelines: options.guidelines,
    memory: options.memory,
  });

  const modelCatalog = options.catalog ?? createCodaraModelCatalog({
    config: options.config,
  });

  // 支持 modelResolver 作为 model 的替代
  const model = options.model ?? (options.modelResolver ? options.modelResolver() : undefined);

  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options, sourceProvider);

  return createSession({
    sessionId: options.sessionId,
    threadId: options.threadId,
    alias: options.alias ?? 'default',
    model,
    modelCatalog,
    sourceProvider,
    tools,
    middleware,
    checkpointer: options.checkpointer,
    restore: options.restore,
    inputBudget: options.inputBudget,
    messages: options.messages,
    context: options.context,
    values: options.values,
  }) as Codara;
}
