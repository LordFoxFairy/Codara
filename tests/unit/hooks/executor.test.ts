import {describe, expect, test} from 'bun:test';
import {CommandExecutionStrategy, PromptExecutionStrategy, createHookExecutor} from '@engine/hook/executor';
import type {HookDefinition, HookContextBase} from '@engine/hook/types';

const baseContext: HookContextBase = {
  sessionId: 'test-session',
  hookEvent: 'PreToolUse',
  timestamp: new Date().toISOString(),
};

describe('CommandExecutionStrategy', () => {
  const strategy = new CommandExecutionStrategy({projectRoot: '/tmp'});

  test('executes command and parses JSON stdout', async () => {
    const hook: HookDefinition = {
      type: 'command',
      command: 'echo \'{"decision":"allow","systemMessage":"ok"}\'',
      timeout: 5000,
    };
    const output = await strategy.execute(hook, baseContext);
    expect(output.decision).toBe('allow');
    expect(output.systemMessage).toBe('ok');
  });

  test('returns empty output on non-JSON stdout', async () => {
    const hook: HookDefinition = {
      type: 'command',
      command: 'echo "not json"',
      timeout: 5000,
    };
    const output = await strategy.execute(hook, baseContext);
    expect(output.decision).toBeUndefined();
  });

  test('returns empty output on non-zero exit (pass, not deny)', async () => {
    const hook: HookDefinition = {
      type: 'command',
      command: 'exit 1',
      timeout: 5000,
    };
    const output = await strategy.execute(hook, baseContext);
    expect(output.decision).toBeUndefined(); // pass, not deny
  });

  test('returns empty output on timeout', async () => {
    const hook: HookDefinition = {
      type: 'command',
      command: 'sleep 10',
      timeout: 100, // 100ms timeout
    };
    const output = await strategy.execute(hook, baseContext);
    expect(output.decision).toBeUndefined();
  });

  test('passes context as stdin JSON', async () => {
    const hook: HookDefinition = {
      type: 'command',
      // Read stdin, extract hookEvent, echo it back
      command: 'cat | node -e "process.stdin.resume();let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{const j=JSON.parse(d);console.log(JSON.stringify({systemMessage:j.hookEvent}))})"',
      timeout: 5000,
    };
    const output = await strategy.execute(hook, baseContext);
    expect(output.systemMessage).toBe('PreToolUse');
  });

  test('expands $CODARA_PROJECT_ROOT in command', async () => {
    const s = new CommandExecutionStrategy({projectRoot: '/my/project'});
    const hook: HookDefinition = {
      type: 'command',
      command: 'echo \'{"systemMessage":"\'$CODARA_PROJECT_ROOT\'"}\'',
      timeout: 5000,
    };
    const output = await s.execute(hook, baseContext);
    expect(output.systemMessage).toBe('/my/project');
  });
});

describe('createHookExecutor', () => {
  test('returns CommandExecutionStrategy for command type', () => {
    const hook: HookDefinition = {type: 'command', command: 'echo', timeout: 5000};
    const executor = createHookExecutor(hook, {projectRoot: '/tmp'});
    expect(executor).toBeInstanceOf(CommandExecutionStrategy);
  });

  test('returns PromptExecutionStrategy for prompt type', () => {
    const hook: HookDefinition = {type: 'prompt', prompt: 'test', timeout: 5000};
    const mockCreateModel = () => ({} as any);
    const executor = createHookExecutor(hook, {projectRoot: '/tmp', createModel: mockCreateModel});
    expect(executor).toBeInstanceOf(PromptExecutionStrategy);
  });
});
