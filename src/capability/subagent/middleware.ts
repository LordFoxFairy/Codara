import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {createSubagentCatalogMessage, readSkillsRuntimeData} from '@capability/skill';
import {createAgentRuntime} from '@capability/subagent/runtime';
import {createAgentRunMemoryStore} from '@capability/subagent/run-store';
import {
  createAgentTool,
  type CreateAgentToolOptions,
} from '@capability/subagent/tool';
import {
  buildAgentChildMiddlewares,
  type AgentChildRuntimeOptions,
} from '@capability/subagent/child-middlewares';
import {
  buildAgentCompletionHandoff,
  maybeHandleAgentCompletionToolCall,
} from '@capability/subagent/completion-handoff';

export {createAgentTool, readAgentToolOptions, AGENT_TOOL_DESCRIPTION, AGENT_TOOL_NAME} from '@capability/subagent/tool';
export type {CreateAgentToolOptions} from '@capability/subagent/tool';
export type {AgentChildRuntimeOptions} from '@capability/subagent/child-middlewares';

export interface CreateAgentMiddlewareOptions extends CreateAgentToolOptions {
  name?: string;
  childRuntime?: AgentChildRuntimeOptions;
}

export function createAgentMiddleware(options: CreateAgentMiddlewareOptions): BaseMiddleware {
  const runStore = options.runStore ?? createAgentRunMemoryStore();
  const runtime = options.runtime ?? createAgentRuntime({
    runStore,
    approvalStore: options.approvalStore,
  });
  const childMiddlewares = buildAgentChildMiddlewares(options);

  return createMiddleware({
    name: options.name?.trim() || 'AgentMiddleware',
    tools: [createAgentTool({...options, runStore, runtime, childMiddleware: childMiddlewares})],
    beforeModel(context) {
      const completionHandoff = buildAgentCompletionHandoff(context);
      if (completionHandoff) {
        context.systemMessage.push(completionHandoff);
      }

      const definitions = createSubagentCatalogMessage(readSkillsRuntimeData(context.runtime.shared));
      if (definitions) {
        context.systemMessage.push(definitions);
      }

      return undefined;
    },
    async wrapToolCall(context, handler) {
      const blocked = maybeHandleAgentCompletionToolCall(context);
      if (blocked) {
        return blocked;
      }
      return handler(context);
    },
  });
}
