import type {BaseMessage, SystemMessage} from "@langchain/core/messages";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import type {StructuredToolInterface} from "@langchain/core/tools";

/** Agent 运行时状态 */
export interface AgentState {
    messages: BaseMessage[];
}

/** Agent 完成原因 */
export type AgentFinishReason = "complete" | "error" | "max_turns";

/** Agent 执行结果 */
export interface AgentResult {
    reason: AgentFinishReason;
    state: AgentState;
    turns: number;
    error?: Error;
}

/** Agent 构造参数 */
export interface AgentRunnerParams {
    model: BaseChatModel;
    tools?: StructuredToolInterface[];
    systemPrompt?: string | SystemMessage;
    /** 工具执行失败时是否返回错误消息（默认 true），false 时向上抛出异常 */
    handleToolErrors?: boolean;
}

/** Agent 调用配置 */
export interface AgentInvokeConfig {
    /** 最大循环轮次，默认 25 */
    recursionLimit?: number;
    /** 取消信号 */
    signal?: AbortSignal;
}
