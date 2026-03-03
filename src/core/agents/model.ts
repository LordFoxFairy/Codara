import type {BaseMessage, ToolCall} from "@langchain/core/messages";

export interface AgentTool {
    name: string;
    invoke(args: unknown): Promise<unknown>;
}

export interface AgentModelResponse extends BaseMessage {
    tool_calls?: ToolCall[];
}

export interface AgentModel {
    invoke(messages: BaseMessage[]): Promise<AgentModelResponse>;
}

export interface AgentLoopContext {
    messages: BaseMessage[];
    model: AgentModel;
    toolsByName: Map<string, AgentTool>;
}
