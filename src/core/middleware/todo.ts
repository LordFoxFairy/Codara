import {ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {Command} from '@core/agents/command';
import type {AgentRuntimeValues} from '@core/agents/contract/agent';
import {createMiddleware, type BaseMiddleware, type AfterModelContext} from '@core/middleware';

/**
 * Ported from LangChain JS todoListMiddleware.
 */
export const WRITE_TODOS_DESCRIPTION = `Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.
Only use this tool if you think it will be helpful in staying organized. If the user's request is trivial and takes less than 3 steps, it is better to NOT use this tool and just do the task directly.

## When to Use This Tool
Use this tool in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. The plan may need future revisions or updates based on results from the first few steps. Keeping track of this in a list is helpful.

## How to Use This Tool
1. When you start working on a task - Mark it as in_progress BEFORE beginning work.
2. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation.
3. You can also update future tasks, such as deleting them if they are no longer necessary, or adding new tasks that are necessary. Don't change previously completed tasks.
4. You can make several updates to the todo list at once. For example, when you complete a task, you can mark the next task you need to start as in_progress.

## When NOT to Use This Tool
It is important to skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on
   - completed: Task finished successfully

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing
   - Remove tasks that are no longer relevant from the list entirely
   - IMPORTANT: When you write this todo list, you should mark your first task as in_progress immediately.
   - IMPORTANT: Unless all tasks are completed, you should always have at least one task in_progress.

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter blockers, keep the task as in_progress
   - Never mark a task as completed if work is partial or incomplete

Remember: If you only need to make a few tool calls to complete a task, and it is clear what you need to do, it is better to just do the task directly and NOT call this tool at all.`;

export const TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT = `## \`write_todos\`

You have access to the \`write_todos\` tool to help you manage and plan complex objectives.
Use this tool for complex objectives to ensure that you are tracking each necessary step and giving the user visibility into your progress.
This tool is very helpful for planning complex objectives, and for breaking down these larger complex objectives into smaller steps.

It is critical that you mark todos as completed as soon as you are done with a step. Do not batch up multiple steps before marking them as completed.
For simple objectives that only require a few steps, it is better to just complete the objective directly and NOT use this tool.
Writing todos takes time and tokens, use it when it is helpful for managing complex many-step problems, but not for simple few-step requests.

## Important To-Do List Usage Notes to Remember
- The \`write_todos\` tool should never be called multiple times in parallel.
- Don't be afraid to revise the To-Do list as you go. New information may reveal new tasks that need to be done, or old tasks that are irrelevant.`;

export const TODO_TOOL_NAME = 'write_todos';

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed']).describe('Status of the todo');
export const TodoSchema = z.object({
  content: z.string().describe('Content of the todo item'),
  status: TodoStatusSchema,
});
export const TodoStateSchema = z.object({
  todos: z.array(TodoSchema).default([]),
});

export type TodoMiddlewareState = z.infer<typeof TodoStateSchema>;

export interface TodoListMiddlewareOptions {
  systemPrompt?: string;
  toolDescription?: string;
}

export function readTodoState(values: AgentRuntimeValues | undefined): TodoMiddlewareState {
  const parsed = TodoStateSchema.safeParse(values ?? {});
  return parsed.success ? parsed.data : {todos: []};
}

export function createWriteTodosTool(options?: Pick<TodoListMiddlewareOptions, 'toolDescription'>) {
  return tool(
    ({todos}, config) => {
      return new Command({
        update: {
          values: {todos},
          messages: [
            new ToolMessage({
              content: `Updated todo list to ${JSON.stringify(todos)}`,
              tool_call_id: config.toolCall?.id as string,
            }),
          ],
        },
      });
    },
    {
      name: TODO_TOOL_NAME,
      description: options?.toolDescription ?? WRITE_TODOS_DESCRIPTION,
      schema: z.object({
        todos: z.array(TodoSchema).describe('List of todo items to update'),
      }),
    },
  );
}

export function todoListMiddleware(options?: TodoListMiddlewareOptions): BaseMiddleware {
  const writeTodos = createWriteTodosTool(options);

  return createMiddleware({
    name: 'todoListMiddleware',
    stateSchema: TodoStateSchema,
    tools: [writeTodos],
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        systemMessage: request.systemMessage.concat(`\n\n${options?.systemPrompt ?? TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT}`),
      }),
    afterModel: (context) => rejectParallelWriteTodos(context),
  });
}

function rejectParallelWriteTodos(context: AfterModelContext): {messages: ToolMessage[]} | undefined {
  const lastAiMessage = context.response;
  const toolCalls = Array.isArray(lastAiMessage.tool_calls) ? lastAiMessage.tool_calls : [];
  const writeTodoCalls = toolCalls.filter((toolCall) => toolCall.name === TODO_TOOL_NAME);

  if (writeTodoCalls.length <= 1) {
    return undefined;
  }

  lastAiMessage.tool_calls = toolCalls.filter((toolCall) => toolCall.name !== TODO_TOOL_NAME);

  return {
    messages: writeTodoCalls.map((toolCall) => new ToolMessage({
      content:
        'Error: The `write_todos` tool should never be called multiple times in parallel. ' +
        'Please call it only once per model invocation to update the todo list.',
      tool_call_id: typeof toolCall.id === 'string' ? toolCall.id : '',
      status: 'error',
    })),
  };
}
