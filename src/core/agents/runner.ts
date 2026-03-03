import {HumanMessage, ToolMessage} from "@langchain/core/messages";
import type {AgentLoopContext} from "@core/agents/model";

export async function runAgentLoop(
    context: AgentLoopContext,
    input: string
): Promise<"complete" | "error"> {
    context.messages.push(new HumanMessage(input));

    try {
        while (true) {
            const response = await context.model.invoke(context.messages);
            context.messages.push(response);

            if (!response.tool_calls?.length) {
                return "complete";
            }

            for (const toolCall of response.tool_calls) {
                const output = await context.toolsByName.get(toolCall.name)!.invoke(toolCall.args);
                context.messages.push(
                    new ToolMessage({
                        content: String(output),
                        tool_call_id: toolCall.id!,
                    })
                );
            }
        }
    } catch {
        return "error";
    }
}
