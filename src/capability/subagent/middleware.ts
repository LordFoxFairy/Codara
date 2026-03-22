import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {readSkillsRuntimeData} from '@context/skills/runtime-shared';
import type {SkillsRuntimeData} from '@context/skills/contracts';
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

      const definitions = buildAvailableSubagentsMessage(readSkillsRuntimeData(context.runtime.shared));
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

function buildAvailableSubagentsMessage(runtime: SkillsRuntimeData | undefined): string {
  const definitions = Object.values(runtime?.subagentDefinitions ?? {});

  return [
    '### Available Subagents',
    '- Agent: built-in child that starts as a fresh child session and loads project context through normal bootstrap',
    ...definitions.map((definition) => {
      const toolRefs = definition.tools?.length ? ` | tools: ${definition.tools.join(', ')}` : '';
      const maxTurns = typeof definition.maxTurns === 'number' ? ` | max_turns: ${definition.maxTurns}` : '';
      return `- ${definition.name}: ${definition.description}${toolRefs}${maxTurns}`;
    }),
  ].join('\n');
}
