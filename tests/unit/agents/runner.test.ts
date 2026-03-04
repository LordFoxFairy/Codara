import {describe, expect, it} from "bun:test";
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from "@langchain/core/messages";
import {createAgentRunner} from "@core/agents";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import type {StructuredToolInterface} from "@langchain/core/tools";

class FakeModel {
    private index = 0;

    constructor(private readonly responses: AIMessage[]) {}

    async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
        const current = this.responses[this.index];
        this.index += 1;
        return current;
    }

    bindTools(_tools: StructuredToolInterface[]): this {
        return this;
    }
}

describe("AgentRunner", () => {
    it("无 tool_calls 时应直接 complete", async () => {
        const model = new FakeModel([new AIMessage("done")]) as unknown as BaseChatModel;
        const runner = createAgentRunner({model});

        const result = await runner.invoke({messages: [new HumanMessage("hello")]});

        expect(result.reason).toBe("complete");
        expect(result.turns).toBe(1);
        expect(result.state.messages.length).toBe(2);
        expect(result.state.messages[0]).toBeInstanceOf(HumanMessage);
        expect(result.state.messages[1]).toBeInstanceOf(AIMessage);
    });

    it("有 tool_calls 时应执行工具并回写 ToolMessage", async () => {
        const toolCall: ToolCall = {
            id: "call_1",
            name: "echo",
            args: {text: "ping"},
        };

        const tool: StructuredToolInterface = {
            name: "echo",
            description: "Echo tool",
            schema: {} as any,
            invoke: async () => "pong",
        };

        const responses: AIMessage[] = [
            new AIMessage({content: "", tool_calls: [toolCall]}),
            new AIMessage("final"),
        ];

        const model = new FakeModel(responses) as unknown as BaseChatModel;
        const runner = createAgentRunner({model, tools: [tool]});

        const result = await runner.invoke({messages: [new HumanMessage("start")]});

        expect(result.reason).toBe("complete");
        expect(result.turns).toBe(2);

        const toolMessage = result.state.messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
        expect(toolMessage.tool_call_id).toBe("call_1");
        expect(toolMessage.content).toBe("pong");
    });

    it("工具不存在时应返回错误 ToolMessage 而不是崩溃", async () => {
        const toolCall: ToolCall = {
            id: "call_404",
            name: "missing_tool",
            args: {},
        };

        const responses: AIMessage[] = [
            new AIMessage({content: "", tool_calls: [toolCall]}),
            new AIMessage("done"),
        ];

        const model = new FakeModel(responses) as unknown as BaseChatModel;
        const runner = createAgentRunner({model});

        const result = await runner.invoke({messages: [new HumanMessage("start")]});

        expect(result.reason).toBe("complete");
        const toolMessage = result.state.messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
        expect(toolMessage.content).toContain('Tool "missing_tool" not found');
        expect(toolMessage.status).toBe("error");
    });

    it("工具执行失败时应返回错误 ToolMessage 让模型重试", async () => {
        const toolCall: ToolCall = {
            id: "call_err",
            name: "echo",
            args: {text: "ping"},
        };

        const tool: StructuredToolInterface = {
            name: "echo",
            description: "Echo tool",
            schema: {} as any,
            invoke: async () => {
                throw new Error("tool boom");
            },
        };

        const responses: AIMessage[] = [
            new AIMessage({content: "", tool_calls: [toolCall]}),
            new AIMessage("done"),
        ];

        const model = new FakeModel(responses) as unknown as BaseChatModel;
        const runner = createAgentRunner({model, tools: [tool]});

        const result = await runner.invoke({messages: [new HumanMessage("start")]});

        expect(result.reason).toBe("complete");
        const toolMessage = result.state.messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
        expect(toolMessage.content).toContain("Tool execution failed: tool boom");
        expect(toolMessage.status).toBe("error");
    });

    it("模型调用失败时应返回 error", async () => {
        const model = {
            invoke: async () => {
                throw new Error("model boom");
            },
            bindTools: () => ({
                invoke: async () => {
                    throw new Error("model boom");
                },
            }),
        } as unknown as BaseChatModel;

        const runner = createAgentRunner({model});

        const result = await runner.invoke({messages: [new HumanMessage("start")]});

        expect(result.reason).toBe("error");
        expect(result.error?.message).toBe("model boom");
    });

    it("达到 recursionLimit 时应返回 max_turns", async () => {
        const toolCall: ToolCall = {
            id: "call_loop",
            name: "echo",
            args: {},
        };

        const tool: StructuredToolInterface = {
            name: "echo",
            description: "Echo tool",
            schema: {} as any,
            invoke: async () => "pong",
        };

        const model = new FakeModel(
            Array(20).fill(new AIMessage({content: "", tool_calls: [toolCall]}))
        ) as unknown as BaseChatModel;

        const runner = createAgentRunner({model, tools: [tool]});

        const result = await runner.invoke(
            {messages: [new HumanMessage("start")]},
            {recursionLimit: 3}
        );

        expect(result.reason).toBe("max_turns");
        expect(result.turns).toBe(3);
    });

    it("signal 触发时应返回 error", async () => {
        const controller = new AbortController();
        const model = new FakeModel([new AIMessage("done")]) as unknown as BaseChatModel;
        const runner = createAgentRunner({model});

        controller.abort();

        const result = await runner.invoke(
            {messages: [new HumanMessage("start")]},
            {signal: controller.signal}
        );

        expect(result.reason).toBe("error");
        expect(result.error?.message).toContain("Aborted");
    });

    it("handleToolErrors=false 时工具失败应向上抛出异常", async () => {
        const toolCall: ToolCall = {
            id: "call_err",
            name: "echo",
            args: {},
        };

        const tool: StructuredToolInterface = {
            name: "echo",
            description: "Echo tool",
            schema: {} as any,
            invoke: async () => {
                throw new Error("tool boom");
            },
        };

        const responses: AIMessage[] = [
            new AIMessage({content: "", tool_calls: [toolCall]}),
        ];

        const model = new FakeModel(responses) as unknown as BaseChatModel;
        const runner = createAgentRunner({model, tools: [tool], handleToolErrors: false});

        const result = await runner.invoke({messages: [new HumanMessage("start")]});

        expect(result.reason).toBe("error");
        expect(result.error?.message).toContain('Tool "echo" execution failed');
    });
});
