import {describe, expect, it} from "bun:test";
import {AIMessage, HumanMessage, ToolMessage} from "@langchain/core/messages";
import {tool} from "@langchain/core/tools";
import {z} from "zod";
import {runAgentLoop, type AgentLoopContext} from "@core/agents";
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from "@core/provider";

describe("Agent Loop End-to-End", () => {
    it("应通过 bindTools + runAgentLoop 完成一轮真实工具调用", async () => {
        const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
        expect(Boolean(deepseekKey && !deepseekKey.startsWith("your-"))).toBe(true);

        const config = await loadModelRoutingConfig();
        const registry = new ModelRegistry(config);
        const factory = new ChatModelFactory(registry);
        const model = await factory.create("deepseek");

        expect(typeof model.bindTools).toBe("function");

        const echoTool = tool(
            async ({text}: {text: string}) => `ECHO:${text}`,
            {
                name: "echo_text",
                description: "Echo text back",
                schema: z.object({
                    text: z.string(),
                }),
            }
        );

        const boundModel = model.bindTools!([echoTool], {tool_choice: "any"});
        let invokeCount = 0;

        const context: AgentLoopContext = {
            messages: [],
            model: {
                invoke: async (messages) => {
                    invokeCount += 1;
                    if (invokeCount > 3) {
                        return new AIMessage("done");
                    }

                    return await (boundModel as unknown as AgentLoopContext["model"]).invoke(messages);
                },
            },
            toolsByName: new Map([[echoTool.name, echoTool]]),
        };

        const reason = await runAgentLoop(
            context,
            "你必须只调用一次 echo_text 工具，参数 text 必须是 ping。调用后直接结束。"
        );

        expect(reason).toBe("complete");
        expect(invokeCount).toBeGreaterThan(0);

        const human = context.messages[0];
        expect(human).toBeInstanceOf(HumanMessage);

        const toolMessage = context.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
        expect(toolMessage).toBeDefined();
        expect(toolMessage.content).toContain("ECHO:ping");
    }, 120_000);
});
