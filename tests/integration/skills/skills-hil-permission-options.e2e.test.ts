import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentRunner} from '@core/agents';
import {
  applyHILResumeToolEdits,
  createHILMiddleware,
  parseHILResumeActionPayload,
  type HILPauseRequest,
} from '@core/middleware';

class PermissionInteractionModel {
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);

    const text = messages.map((message) => stringifyContent(message.content)).join('\n');
    if (text.includes('executed:git diff --stat')) {
      return new AIMessage('PERMISSION_EDIT_DONE');
    }

    if (text.includes('Edit the command and continue.')) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_perm_choice', name: 'bash', args: {command: 'git status'}} as ToolCall],
      });
    }

    if (text.includes('"type":"hil_pause"')) {
      return new AIMessage('WAITING_FOR_PERMISSION_CHOICE');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_perm_choice', name: 'bash', args: {command: 'git status'}} as ToolCall],
    });
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}

describe('HIL permission choice contract', () => {
  it('should expose permission actions and support edit-and-continue resume', async () => {
    const model = new PermissionInteractionModel();
    const pauseRequests: HILPauseRequest[] = [];

    let executedCommand = '';
    const bashTool = tool(
      async ({command}: {command: string}) => {
        executedCommand = command;
        return `executed:${command}`;
      },
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      }
    );

    const hilMiddleware = createHILMiddleware({
      interruptOn: {
        bash: {
          description: 'Permission review required for shell command',
          channel: 'permission-center',
          ui: {
            tab: 'Security',
            modal: 'permission-review',
            actions: [
              {id: 'allow_once', label: 'Allow once', kind: 'primary'},
              {id: 'always', label: 'Always allow', kind: 'secondary'},
              {id: 'deny', label: 'Deny', kind: 'danger', requiresConfirmation: true},
              {id: 'edit', label: 'Edit and continue', kind: 'secondary', requiresToolEdit: true},
            ],
          },
          metadata: {skill: 'permission-policy'},
        },
      },
      onPause: (request) => {
        pauseRequests.push(request);
      },
      handleResume: async (_request, resumePayload, context, handler) => {
        const action = parseHILResumeActionPayload(resumePayload);
        if (action.action === 'deny') {
          return new ToolMessage({
            content: 'Denied by user',
            tool_call_id: context.toolCall.id ?? 'denied',
            status: 'error',
          });
        }

        if (action.action === 'edit') {
          return handler(applyHILResumeToolEdits(context, action));
        }

        return handler(context);
      },
    });

    const runner = createAgentRunner({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [hilMiddleware],
    });

    const firstResult = await runner.invoke(
      {messages: [new HumanMessage('Run git status with permission review.')]},
      {recursionLimit: 4}
    );

    expect(firstResult.reason).toBe('complete');
    expect(String(firstResult.state.messages[firstResult.state.messages.length - 1]?.content)).toContain(
      'WAITING_FOR_PERMISSION_CHOICE'
    );
    expect(executedCommand).toBe('');
    expect(pauseRequests).toHaveLength(1);
    const actions = ((pauseRequests[0]?.ui as {actions?: Array<{id: string}>} | undefined)?.actions ?? []);
    expect(actions.map((item) => item.id)).toEqual([
      'allow_once',
      'always',
      'deny',
      'edit',
    ]);

    const secondResult = await runner.invoke(
      {
        messages: [...firstResult.state.messages, new HumanMessage('Edit the command and continue.')],
      },
      {
        recursionLimit: 4,
        context: {
          hil: {
            resume: {
              action: 'edit',
              editedToolArgs: {command: 'git diff --stat'},
            },
          },
        },
      }
    );

    expect(secondResult.reason).toBe('complete');
    expect(String(secondResult.state.messages[secondResult.state.messages.length - 1]?.content)).toContain(
      'PERMISSION_EDIT_DONE'
    );
    expect(executedCommand).toBe('git diff --stat');
  });
});
