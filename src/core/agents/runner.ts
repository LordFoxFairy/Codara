import {SystemMessage, ToolMessage, type AIMessage, type ToolCall} from "@langchain/core/messages";
import type {StructuredToolInterface} from "@langchain/core/tools";
import type {Runnable} from "@langchain/core/runnables";
import type {
    AgentState, AgentResult, AgentRunnerParams, AgentInvokeConfig,
} from "@core/agents/types";

/** 默认最大循环轮次 */
const DEFAULT_RECURSION_LIMIT = 25;

/**
 * ReAct 模式的 Agent 循环执行器。
 *
 * @example
 * ```typescript
 * const runner = createAgentRunner({
 *     model,
 *     tools: [searchTool],
 *     systemPrompt: "你是一个助手",
 * });
 *
 * const result = await runner.invoke({messages: [new HumanMessage("hello")]});
 * ```
 */
export class AgentRunner {
    private readonly boundModel: Runnable;
    private readonly toolMap: Map<string, StructuredToolInterface>;
    private readonly systemMessage?: SystemMessage;
    private readonly handleToolErrors: boolean;

    constructor(params: AgentRunnerParams) {
        const {model, tools = [], systemPrompt, handleToolErrors = true} = params;

        if (!model.bindTools) {
            throw new Error("Model does not support tool calling");
        }

        this.boundModel = model.bindTools(tools);
        this.toolMap = new Map(tools.map(t => [t.name, t]));
        this.systemMessage = typeof systemPrompt === "string"
            ? new SystemMessage(systemPrompt)
            : systemPrompt;
        this.handleToolErrors = handleToolErrors;
    }

    async invoke(state: AgentState, config?: AgentInvokeConfig): Promise<AgentResult> {
        const maxTurns = config?.recursionLimit ?? DEFAULT_RECURSION_LIMIT;
        const signal = config?.signal;

        if (maxTurns < 1) {
            throw new Error("recursionLimit must be at least 1");
        }

        if (this.systemMessage) {
            state.messages.unshift(this.systemMessage);
        }

        let turns = 0;

        try {
            while (turns < maxTurns) {
                if (signal?.aborted) {
                    return {reason: "error", state, turns, error: new Error("Aborted")};
                }

                turns++;

                const response = await this.invokeModel(state);
                state.messages.push(response);

                if (!response.tool_calls?.length) {
                    return {reason: "complete", state, turns};
                }

                const toolMessages = await Promise.all(
                    response.tool_calls.map(tc => this.invokeTool(tc))
                );
                state.messages.push(...toolMessages);
            }

            return {reason: "max_turns", state, turns};
        } catch (error) {
            return {
                reason: "error",
                state,
                turns,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    /** 调用模型，后续 wrapModelCall middleware 可包装此方法 */
    private async invokeModel(state: AgentState): Promise<AIMessage> {
        return await this.boundModel.invoke(state.messages) as AIMessage;
    }

    /** 调用工具，后续 wrapToolCall middleware 可包装此方法 */
    private async invokeTool(toolCall: ToolCall): Promise<ToolMessage> {
        const tool = this.toolMap.get(toolCall.name);

        if (!tool) {
            return new ToolMessage({
                content: `Tool "${toolCall.name}" not found`,
                tool_call_id: toolCall.id!,
                status: "error",
            });
        }

        try {
            const content = String(await tool.invoke(toolCall.args));
            return new ToolMessage({content, tool_call_id: toolCall.id!});
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (!this.handleToolErrors) {
                throw new Error(`Tool "${toolCall.name}" execution failed: ${errorMessage}`);
            }

            return new ToolMessage({
                content: `Tool execution failed: ${errorMessage}`,
                tool_call_id: toolCall.id!,
                status: "error",
            });
        }
    }
}

export function createAgentRunner(params: AgentRunnerParams): AgentRunner {
    return new AgentRunner(params);
}
