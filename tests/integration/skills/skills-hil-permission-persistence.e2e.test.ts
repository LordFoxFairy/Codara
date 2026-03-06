import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentRunner} from '@core/agents';
import {createHILMiddleware, parseHILResumeActionPayload, type HILDecision} from '@core/middleware';

class PermissionPersistenceModel {
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);

    const text = messages.map((message) => stringifyContent(message.content)).join('\n');
    if (text.includes('executed:git status')) {
      return new AIMessage('PERMISSION_GRANTED_DONE');
    }

    if (text.includes('Always allow this command.')) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_permission_persist', name: 'bash', args: {command: 'git status'}} as ToolCall],
      });
    }

    if (text.includes('"type":"hil_pause"')) {
      return new AIMessage('WAITING_FOR_PERMISSION');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_permission_persist', name: 'bash', args: {command: 'git status'}} as ToolCall],
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

function toPermissionExpression(toolCall: ToolCall): string {
  if (toolCall.name === 'bash') {
    const args = toolCall.args as {command?: unknown};
    if (typeof args.command === 'string' && args.command.trim()) {
      return `Bash(${args.command})`;
    }
  }

  throw new Error(`Unsupported permission expression for tool: ${toolCall.name}`);
}

function evaluatePermissionDecision(
  evaluateScript: string,
  projectRoot: string,
  toolCall: ToolCall
): HILDecision {
  const result = Bun.spawnSync({
    cmd: ['bash', evaluateScript, toPermissionExpression(toolCall), '--profile', 'codara', '--project-root', projectRoot],
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || 'Failed to evaluate permission');
  }

  const payload = JSON.parse(new TextDecoder().decode(result.stdout).trim()) as {decision: string};
  if (payload.decision === 'allow') {
    return {decision: 'allow'};
  }

  if (payload.decision === 'deny') {
    return {decision: 'deny', reason: 'Denied by permission policy'};
  }

  return {
    decision: 'ask',
    config: {
      description: 'Permission review required for shell command',
      channel: 'permission-center',
      ui: {
        tab: 'Security',
        modal: 'permission-review',
        actions: [
          {id: 'allow_once', label: 'Allow once', kind: 'primary'},
          {id: 'always', label: 'Always allow', kind: 'secondary'},
          {id: 'deny', label: 'Deny', kind: 'danger', requiresConfirmation: true},
        ],
      },
      metadata: {skill: 'permission-policy'},
    },
  };
}

describe('HIL permission persistence flow', () => {
  it('should persist Always allow into settings.local.json and skip pause on the next run', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-permission-persist-'));
    const skillRoot = path.join(process.cwd(), '.codara', 'skills', 'permission-policy');
    const evaluateScript = path.join(skillRoot, 'scripts', 'evaluate-permission.sh');
    const upsertScript = path.join(skillRoot, 'scripts', 'upsert-permission-rule.sh');

    let bashInvokeCount = 0;
    const bashTool = tool(
      async ({command}: {command: string}) => {
        bashInvokeCount += 1;
        return `executed:${command}`;
      },
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      }
    );

    const firstPauseIds: string[] = [];
    const persistenceMiddleware = createHILMiddleware({
      resolveDecision: async ({context}) => evaluatePermissionDecision(evaluateScript, root, context.toolCall),
      onPause: (request) => {
        firstPauseIds.push(request.id);
      },
      handleResume: async (request, resumePayload, context, handler) => {
        const payload = parseHILResumeActionPayload(resumePayload);

        if (payload.action === 'deny') {
          return new ToolMessage({
            content: 'Denied by user',
            tool_call_id: context.toolCall.id ?? 'denied',
            status: 'error',
          });
        }

        if (payload.action === 'always') {
          const persistResult = Bun.spawnSync({
            cmd: ['bash', upsertScript, toPermissionExpression(context.toolCall), '--project-root', root],
            stdout: 'pipe',
            stderr: 'pipe'
          });

          if (persistResult.exitCode !== 0) {
            throw new Error(new TextDecoder().decode(persistResult.stderr).trim() || 'Failed to persist permission');
          }
        }

        return handler(context);
      },
    });

    const firstRunner = createAgentRunner({
      model: new PermissionPersistenceModel() as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [persistenceMiddleware],
    });

    const firstResult = await firstRunner.invoke(
      {messages: [new HumanMessage('Run git status.')]},
      {recursionLimit: 4}
    );

    expect(firstResult.reason).toBe('complete');
    expect(String(firstResult.state.messages[firstResult.state.messages.length - 1]?.content)).toContain(
      'WAITING_FOR_PERMISSION'
    );
    expect(bashInvokeCount).toBe(0);
    expect(firstPauseIds).toHaveLength(1);

    const secondResult = await firstRunner.invoke(
      {
        messages: [...firstResult.state.messages, new HumanMessage('Always allow this command.')],
      },
      {
        recursionLimit: 4,
        context: {
          hil: {
            resume: {
              action: 'always',
            },
          },
        },
      }
    );

    expect(secondResult.reason).toBe('complete');
    expect(String(secondResult.state.messages[secondResult.state.messages.length - 1]?.content)).toContain(
      'PERMISSION_GRANTED_DONE'
    );
    expect(bashInvokeCount).toBe(1);

    const settingsFile = path.join(root, '.codara', 'settings.local.json');
    const settings = await Bun.file(settingsFile).json() as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(settings.permissions?.rules?.allow).toEqual(['Bash(git status)']);

    const secondPauseIds: string[] = [];
    const secondRunner = createAgentRunner({
      model: new PermissionPersistenceModel() as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [
        createHILMiddleware({
          resolveDecision: async ({context}) => evaluatePermissionDecision(evaluateScript, root, context.toolCall),
          onPause: (request) => {
            secondPauseIds.push(request.id);
          },
        }),
      ],
    });

    const thirdResult = await secondRunner.invoke(
      {messages: [new HumanMessage('Run git status again.')]},
      {recursionLimit: 4}
    );

    expect(thirdResult.reason).toBe('complete');
    expect(String(thirdResult.state.messages[thirdResult.state.messages.length - 1]?.content)).toContain(
      'PERMISSION_GRANTED_DONE'
    );
    expect(bashInvokeCount).toBe(2);
    expect(secondPauseIds).toHaveLength(0);
  });
});
