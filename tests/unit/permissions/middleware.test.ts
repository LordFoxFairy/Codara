import {describe, expect, it} from 'bun:test';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {createPermissionMiddleware, ensurePermissionSettingsFile} from '@core';
import {parseHILToolMessagePayload, type ToolCallContext} from '@core/middleware';
import {createPermissionMiddlewareInternal} from '@core/middleware/permission/middleware';

function createToolContext(toolCall: ToolCall, runtimeContext: Record<string, unknown> = {}): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: runtimeContext},
    systemMessage: [],
    execution: {
      sessionId: 'session_permission_mw_1',
      runId: 'run_permission_mw_1',
      turn: 1,
      maxTurns: 3,
      requestId: 'req_permission_mw_1',
      toolIndex: 0,
      toolCallId: toolCall.id ?? 'tool_0',
    },
    toolCall,
    toolIndex: 0,
  };
}

class StaticPermissionAnalysisModel {
  constructor(
    private readonly payload: {
      reason?: string | null;
      pathScopeExpression?: string | null;
      toolScopeExpression?: string | null;
    },
  ) {}

  async invoke(): Promise<AIMessage> {
    return new AIMessage(JSON.stringify({
      reason: this.payload.reason ?? null,
      pathScopeExpression: this.payload.pathScopeExpression ?? null,
      toolScopeExpression: this.payload.toolScopeExpression ?? null,
    }));
  }
}

describe('createPermissionMiddleware', () => {
  it('should pause unsupported tool calls with permission metadata', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-pause-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_permission_pause_1', name: 'bash', args: {command: 'touch guarded.txt'}};

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_pause_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    expect(payload?.type === 'hil_pause' ? payload.request.channel : '').toBe('permission-center');
    expect(
      payload?.type === 'hil_pause'
        ? (payload.request.metadata as {permissionPolicy?: {expression?: string}}).permissionPolicy?.expression
        : '',
    ).toBe('Bash(touch guarded.txt)');
    expect(
      payload?.type === 'hil_pause'
        ? (payload.request.metadata as {codara?: {actor?: {agentType?: string}}}).codara?.actor?.agentType
        : '',
    ).toBe('main');
  });

  it('should resume through the generic HIL payload contract', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-resume-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_permission_resume_1', name: 'bash', args: {command: 'touch guarded.txt'}};

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resume: {
            action: 'always',
            decision: 'approve',
          },
        },
      }),
      async () => new ToolMessage({content: 'continued', tool_call_id: 'call_permission_resume_1'}),
    );

    expect(String(result?.content)).toBe('continued');
  });

  it('should allow common read-only bash inspection commands from the default settings skeleton', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-allow-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_permission_allow_1', name: 'bash', args: {command: 'git status'}};

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'continued', tool_call_id: 'call_permission_allow_1'});
    });

    expect(String(result?.content)).toBe('continued');
  });

  it('should expose a directory-scoped allow action for file edits', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-path-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_permission_path_1',
      name: 'write_file',
      args: {file_path: 'tmp/demo2/PLAN.md', content: 'hello'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_path_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    const actions = payload?.type === 'hil_pause'
      ? payload.request.ui?.actions ?? []
      : [];
    expect(actions[0]?.id).toBe('allow_once');
    expect(actions[1]?.id).toBe('allow_path');
    expect(actions[1]?.scope).toBe('path');
    expect(actions[1]?.label).toContain('tmp/demo2/');
  });

  it('should expose a directory-scoped allow action for bash mkdir commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-bash-path-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_permission_bash_path_1',
      name: 'bash',
      args: {command: 'mkdir tmp/demo2'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_bash_path_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    const actions = payload?.type === 'hil_pause'
      ? payload.request.ui?.actions ?? []
      : [];
    expect(actions[0]?.id).toBe('allow_once');
    expect(actions[1]?.id).toBe('allow_path');
    expect(actions[1]?.scope).toBe('path');
    expect(actions[1]?.label).toContain('tmp/');
    expect(actions.some((action) => action.id === 'allow_tool')).toBeFalse();
    expect(actions.some((action) => action.id === 'allow_project')).toBeTrue();
  });

  it('should attach a clear approval reason to permission pauses', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-reason-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_permission_reason_1',
      name: 'bash',
      args: {command: 'cat <<\'EOF\' > tmp/demo2/PLAN.md\nhello\nEOF'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_reason_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    const reason = payload?.type === 'hil_pause'
      ? (payload.request.metadata as {permissionPolicy?: {reason?: string}}).permissionPolicy?.reason
      : undefined;
    expect(reason).toContain('tmp/demo2/');
  });

  it('should expose a smarter command-type action label for compound git bash commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-bash-git-label-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_permission_bash_git_label_1',
      name: 'bash',
      args: {command: 'cd ./tmp/repo && git fetch origin && git push origin main'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_bash_git_label_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    const actions = payload?.type === 'hil_pause'
      ? payload.request.ui?.actions ?? []
      : [];
    expect(actions.some((action) => action.id === 'allow_tool' && action.label.includes('git commands'))).toBeTrue();
  });

  it('should expose the same smarter command-type label through shell launcher wrappers', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-bash-wrapper-label-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddleware({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {
      id: 'call_permission_bash_wrapper_label_1',
      name: 'bash',
      args: {command: 'bash -lc "cd ./tmp/repo && git fetch origin && git push origin main"'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_bash_wrapper_label_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    const actions = payload?.type === 'hil_pause'
      ? payload.request.ui?.actions ?? []
      : [];
    expect(actions.some((action) => action.id === 'allow_tool' && action.label.includes('git commands'))).toBeTrue();
  });

  it('should use classifier path suggestions for complex bash writes', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-classifier-path-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddlewareInternal({
      projectRoot,
      cwd: projectRoot,
      bashAnalysisModel: new StaticPermissionAnalysisModel({
        reason: 'Needs approval because this compound command writes under tmp/demo2/.',
        pathScopeExpression: 'Write(tmp/demo2/)',
      }),
    });
    const toolCall: ToolCall = {
      id: 'call_permission_classifier_path_1',
      name: 'bash',
      args: {command: 'cat README.md | tee tmp/demo2/PLAN.md >/dev/null'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_classifier_path_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    const actions = payload?.type === 'hil_pause'
      ? payload.request.ui?.actions ?? []
      : [];
    const reason = payload?.type === 'hil_pause'
      ? (payload.request.metadata as {permissionPolicy?: {reason?: string}}).permissionPolicy?.reason
      : undefined;
    expect(actions.some((action) => action.id === 'allow_path' && action.label.includes('tmp/demo2/'))).toBeTrue();
    expect(reason).toContain('tmp/demo2/');
  });

  it('should persist classifier-suggested path scopes after approval', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-classifier-persist-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const middleware = createPermissionMiddlewareInternal({
      projectRoot,
      cwd: projectRoot,
      bashAnalysisModel: new StaticPermissionAnalysisModel({
        pathScopeExpression: 'Write(tmp/demo2/)',
      }),
    });
    const toolCall: ToolCall = {
      id: 'call_permission_classifier_persist_1',
      name: 'bash',
      args: {command: 'cat README.md | tee tmp/demo2/PLAN.md >/dev/null'},
    };

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resume: {
            action: 'allow_path',
            scope: 'path',
            decision: 'approve',
          },
        },
      }),
      async () => new ToolMessage({content: 'continued', tool_call_id: 'call_permission_classifier_persist_1'}),
    );

    expect(String(result?.content)).toBe('continued');
    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Write(tmp/demo2/)');
  });

  it('should allow complex bash writes when classifier output matches an existing path rule', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-classifier-allow-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const settingsFile = path.join(projectRoot, '.codara', 'settings.local.json');
    const content = JSON.parse(await readFile(settingsFile, 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    content.permissions ??= {};
    content.permissions.rules ??= {};
    content.permissions.rules.allow = [
      ...(content.permissions.rules.allow ?? []),
      'Write(tmp/demo2/)',
    ];
    await Bun.write(settingsFile, `${JSON.stringify(content, null, 2)}\n`);

    const middleware = createPermissionMiddlewareInternal({
      projectRoot,
      cwd: projectRoot,
      bashAnalysisModel: new StaticPermissionAnalysisModel({
        pathScopeExpression: 'Write(tmp/demo2/)',
      }),
    });
    const toolCall: ToolCall = {
      id: 'call_permission_classifier_allow_1',
      name: 'bash',
      args: {command: 'cat README.md | tee tmp/demo2/PLAN.md >/dev/null'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'continued', tool_call_id: 'call_permission_classifier_allow_1'});
    });

    expect(String(result?.content)).toBe('continued');
  });

  it('should keep classifier-derived path matches in ask when the normalized target is guarded', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-mw-classifier-ask-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const settingsFile = path.join(projectRoot, '.codara', 'settings.local.json');
    await Bun.write(settingsFile, `${JSON.stringify({
      permissions: {
        rules: {
          allow: [],
          ask: ['Write(tmp/demo2/)'],
          deny: [],
        },
      },
    }, null, 2)}\n`);

    const middleware = createPermissionMiddlewareInternal({
      projectRoot,
      cwd: projectRoot,
      bashAnalysisModel: new StaticPermissionAnalysisModel({
        pathScopeExpression: 'Write(tmp/demo2/)',
      }),
    });
    const toolCall: ToolCall = {
      id: 'call_permission_classifier_ask_1',
      name: 'bash',
      args: {command: 'cat README.md | tee tmp/demo2/PLAN.md >/dev/null'},
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_permission_classifier_ask_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    expect(
      payload?.type === 'hil_pause'
        ? (payload.request.metadata as {permissionPolicy?: {matched?: {rule?: string}}}).permissionPolicy?.matched?.rule
        : undefined,
    ).toBe('Write(tmp/demo2/)');
  });
});
