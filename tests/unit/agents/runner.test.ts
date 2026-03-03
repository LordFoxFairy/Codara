import {describe, expect, it} from "bun:test";
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from "@langchain/core/messages";
import {runAgentLoop, type AgentLoopContext, type AgentModelResponse} from "@core/agents";

class FakeModel {
    private index = 0;

    constructor(private readonly responses: AgentModelResponse[]) {}

    async invoke(_messages: BaseMessage[]): Promise<AgentModelResponse> {
        const current = this.responses[this.index];
        this.index += 1;
        return current;
    }
}

describe("runAgentLoop", () => {
    it("无 tool_calls 时应直接 complete", async () => {
        const context: AgentLoopContext = {
            messages: [],
            model: new FakeModel([new AIMessage("done")]),
            toolsByName: new Map(),
        };

        const reason = await runAgentLoop(context, "hello");

        expect(reason).toBe("complete");
        expect(context.messages.length).toBe(2);
        expect(context.messages[0]).toBeInstanceOf(HumanMessage);
        expect(context.messages[1]).toBeInstanceOf(AIMessage);
    });

    it("有 tool_calls 时应执行工具并回写 ToolMessage", async () => {
        const toolCall: ToolCall = {
            id: "call_1",
            name: "echo",
            args: {text: "ping"},
        };

        const tool = {
            name: "echo",
            invoke: async () => "pong",
        };

        const responses: AgentModelResponse[] = [
            new AIMessage({content: "", tool_calls: [toolCall]}),
            new AIMessage("final"),
        ];

        const context: AgentLoopContext = {
            messages: [],
            model: new FakeModel(responses),
            toolsByName: new Map([["echo", tool]]),
        };

        const reason = await runAgentLoop(context, "start");

        expect(reason).toBe("complete");

        const toolMessage = context.messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
        expect(toolMessage.tool_call_id).toBe("call_1");
        expect(toolMessage.content).toBe("pong");
    });

    it("工具不存在时应返回 error", async () => {
        const toolCall: ToolCall = {
            id: "call_404",
            name: "missing_tool",
            args: {},
        };

        const context: AgentLoopContext = {
            messages: [],
            model: new FakeModel([new AIMessage({content: "", tool_calls: [toolCall]})]),
            toolsByName: new Map(),
        };

        const reason = await runAgentLoop(context, "start");

        expect(reason).toBe("error");
    });

    it("工具执行失败时应返回 error", async () => {
        const toolCall: ToolCall = {
            id: "call_err",
            name: "echo",
            args: {text: "ping"},
        };

        const tool = {
            name: "echo",
            invoke: async () => {
                throw new Error("tool boom");
            },
        };

        const context: AgentLoopContext = {
            messages: [],
            model: new FakeModel([new AIMessage({content: "", tool_calls: [toolCall]})]),
            toolsByName: new Map([["echo", tool]]),
        };

        const reason = await runAgentLoop(context, "start");

        expect(reason).toBe("error");
    });

    it("模型调用失败时应返回 error", async () => {
        const context: AgentLoopContext = {
            messages: [],
            model: {
                invoke: async () => {
                    throw new Error("model boom");
                },
            },
            toolsByName: new Map(),
        };

        const reason = await runAgentLoop(context, "start");

        expect(reason).toBe("error");
    });
});
