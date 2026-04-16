import {ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {Command} from '@core/agent/command';
import type {AgentRuntimeValues} from '@shared/agent-types';
import {createMiddleware, type BaseMiddleware, type AfterModelContext} from '@core/pipeline-types';

export const WRITE_TODOS_DESCRIPTION = `Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.
Only use this tool if you think it will be helpful in staying organized. If the user's request is trivial and takes less than 3 steps, it is better to NOT use this tool and just do the task directly.

## When to Use This Tool
1. Complex multi-step tasks (3+ distinct steps)
2. Non-trivial tasks requiring careful planning
3. User explicitly requests todo list
4. User provides multiple tasks (numbered or comma-separated)
5. The plan may need future revisions based on intermediate results

## How to Use This Tool
1. Mark a task as in_progress BEFORE beginning work
2. Mark it as completed after finishing, add follow-up tasks discovered during implementation
3. Update future tasks as needed (delete irrelevant ones, add new ones). Don't change completed tasks
4. You can make several updates at once (e.g. complete one task and mark the next as in_progress)

## When NOT to Use This Tool
1. Single, straightforward task
2. Trivial task with no tracking benefit
3. Task completable in less than 3 trivial steps
4. Purely conversational or informational task

## Task States
- pending: Not yet started
- in_progress: Currently working on
- completed: Finished successfully

**Rules**: Update status in real-time. Mark tasks complete IMMEDIATELY after finishing. Remove irrelevant tasks. Always have at least one task in_progress unless all are completed. ONLY mark completed when FULLY accomplished.`;

export const TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT = `## \`write_todos\`

You have access to the \`write_todos\` tool to help you manage and plan complex objectives.
Use this tool for complex objectives to ensure that you are tracking each necessary step and giving the user visibility into your progress.

It is critical that you mark todos as completed as soon as you are done with a step. Do not batch up multiple steps before marking them as completed.
For simple objectives that only require a few steps, it is better to just complete the objective directly and NOT use this tool.

## Important To-Do List Usage Notes
- The \`write_todos\` tool should never be called multiple times in parallel.
- Don't be afraid to revise the To-Do list as you go.
- Use \`write_todos\` for your local execution plan, \`Agent\` for delegated fresh-context work, and \`TaskCreate\` / \`TaskUpdate\` / \`TaskList\` for shared coordination across agents.
- Do not treat slash commands or permission approvals as substitutes for task tracking.`;

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
    ({todos}) => {
      return [
        `Updated todo list to ${JSON.stringify(todos)}`,
        new Command({update: {values: {todos}}}),
      ] as const;
    },
    {
      name: TODO_TOOL_NAME,
      description: options?.toolDescription ?? WRITE_TODOS_DESCRIPTION,
      responseFormat: 'content_and_artifact',
      schema: z.object({
        todos: z.array(TodoSchema).describe('List of todo items to update'),
      }),
    },
  );
}

export function createTodoListMiddleware(options?: TodoListMiddlewareOptions): BaseMiddleware {
  const writeTodos = createWriteTodosTool(options);

  return createMiddleware({
    name: 'TodoListMiddleware',
    stateSchema: TodoStateSchema,
    tools: [writeTodos],
    wrapModelCall: async (request, handler) => {
      const todoState = readTodoState(request.state?.values);
      const systemMessages = (request.systemMessage ?? []).concat(options?.systemPrompt ?? TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT);
      const snapshot = formatTodoSnapshot(todoState);

      return handler({
        ...request,
        systemMessage: snapshot ? systemMessages.concat(snapshot) : systemMessages,
      });
    },
    afterModel: (context) => rejectParallelWriteTodos(context),
  });
}

function rejectParallelWriteTodos(context: AfterModelContext): {messages: ToolMessage[]} | undefined {
  const toolCalls = Array.isArray(context.response.tool_calls) ? context.response.tool_calls : [];
  const writeTodoCalls = toolCalls.filter((tc) => tc.name === TODO_TOOL_NAME);
  if (writeTodoCalls.length <= 1) return undefined;

  context.response.tool_calls = toolCalls.filter((tc) => tc.name !== TODO_TOOL_NAME);
  return {
    messages: writeTodoCalls.map((tc) => new ToolMessage({
      content: 'Error: The `write_todos` tool should never be called multiple times in parallel. Please call it only once per model invocation.',
      tool_call_id: typeof tc.id === 'string' ? tc.id : '',
      status: 'error',
    })),
  };
}

function formatTodoSnapshot(state: TodoMiddlewareState): string | undefined {
  if (state.todos.length === 0) return undefined;

  const hasIncomplete = state.todos.some((t) => t.status !== 'completed');
  const items = state.todos.map((todo, i) => {
    const marker = todo.status !== 'completed' ? ' — INCOMPLETE' : '';
    return `${i + 1}. [${todo.status}] ${todo.content}${marker}`;
  });

  return [
    '## Current To-Do List',
    '',
    ...items,
    ...(hasIncomplete ? ['', 'You have incomplete items. Continue using tools to complete them before giving a final text response.'] : []),
  ].join('\n');
}
