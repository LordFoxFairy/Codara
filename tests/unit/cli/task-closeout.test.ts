import {describe, expect, it} from 'bun:test';
import {isInvalidTaskCloseoutResponse, shouldRetryTaskCloseoutResponse} from '../../../src/cli/task-closeout';

describe('task closeout rules', () => {
  it('marks stale waiting or staged narration as invalid', () => {
    expect(isInvalidTaskCloseoutResponse('Phase 1 has started. Waiting for subagent results.')).toBe(true);
    expect(isInvalidTaskCloseoutResponse('I will continue with phase 2 after the subagents return.')).toBe(true);
    expect(isInvalidTaskCloseoutResponse('已启动第一阶段：3 个并行只读 Explore 子代理正在运行。等待第一阶段完成后，将启动第二阶段的串行子代理。全部 5 个子代理完成后，我将统一输出最终总结报告。')).toBe(true);
    expect(isInvalidTaskCloseoutResponse('已启动第一阶段：3 个并行只读 Explore 子代理正在运行。当前处于等待第一阶段全部结果返回的阶段。完成后我将立即按流程进入第二阶段。')).toBe(true);
    expect(isInvalidTaskCloseoutResponse('两个 subagent 都已完成！现在让我汇总它们的发现，提炼出当前架构最核心的边界：')).toBe(true);
    expect(isInvalidTaskCloseoutResponse('Both subagents have completed. Let me summarize their findings before I answer.')).toBe(true);
  });

  it('keeps valid explanatory final answers that describe how subagent completion works', () => {
    expect(isInvalidTaskCloseoutResponse('这种设计确保了 main agent 能够在 subagent 完成后自动继续工作，无需用户干预。')).toBe(false);
    expect(isInvalidTaskCloseoutResponse('subagent 完成后，main agent 会读取回传结果并继续当前任务，最终由 main 对外回复。')).toBe(false);
  });

  it('does not retry when the continuation launched an Agent tool call for the next phase', () => {
    expect(shouldRetryTaskCloseoutResponse({
      text: 'Starting the second phase now.',
      launchedTaskToolCall: true,
      attempt: 1,
      maxAttempts: 2,
    })).toBe(false);
  });

  it('retries invalid closeout narration when no next-phase task launch happened yet', () => {
    expect(shouldRetryTaskCloseoutResponse({
      text: 'Phase 1 has started. Waiting for subagent results.',
      launchedTaskToolCall: false,
      attempt: 1,
      maxAttempts: 2,
    })).toBe(true);
    expect(shouldRetryTaskCloseoutResponse({
      text: '已启动第一阶段：3 个并行只读 Explore 子代理正在运行。等待第一阶段完成后，将启动第二阶段的串行子代理。全部 5 个子代理完成后，我将统一输出最终总结报告。',
      launchedTaskToolCall: false,
      attempt: 1,
      maxAttempts: 2,
    })).toBe(true);
    expect(shouldRetryTaskCloseoutResponse({
      text: '已按流程完成所有编排启动：当前状态是等待所有 5 个子代理完成分析，待全部结果就绪后我将统一输出最终总结。',
      launchedTaskToolCall: false,
      attempt: 2,
      maxAttempts: 3,
    })).toBe(true);
    expect(shouldRetryTaskCloseoutResponse({
      text: '已按流程完成所有子代理的编排启动。继续等待子代理返回结果，全部完成后我再统一输出最终总结。',
      launchedTaskToolCall: false,
      attempt: 3,
      maxAttempts: 3,
    })).toBe(false);
  });
});
