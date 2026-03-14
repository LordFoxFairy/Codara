// tests/integration/permission-middleware.test.ts

import { describe, it, expect, vi } from 'vitest';
import { PermissionMiddlewareAdapter } from '@/core/permission/adapter';
import type { HILDecisionContext } from '@/core/middleware/hil';
import type { ToolCallContext } from '@/core/middleware/types';

describe('Permission Middleware Integration', () => {
  it('should resolve allow decision', async () => {
    const adapter = new PermissionMiddlewareAdapter();

    const mockContext: HILDecisionContext = {
      context: {
        toolCall: {
          name: 'Read',
          args: { file_path: 'src/index.ts' },
          id: 'test-123',
          type: 'tool_call'
        },
        runtime: {
          projectRoot: process.cwd(),
          userHome: process.env.HOME || '/home/user'
        }
      } as any,
      effectiveConfig: {
        descriptionPrefix: 'Test'
      },
      interruptConfig: null
    };

    const decision = await adapter.resolveDecision(mockContext);

    expect(decision).toBeDefined();
    expect(decision?.decision).toMatch(/allow|ask|deny/);
  });

  it('should handle session memory', async () => {
    const adapter = new PermissionMiddlewareAdapter();

    // 模拟添加会话记忆
    const mockContext: HILDecisionContext = {
      context: {
        toolCall: {
          name: 'Edit',
          args: { file_path: 'src/components/Header.tsx' },
          id: 'test-123',
          type: 'tool_call'
        },
        runtime: {
          projectRoot: process.cwd(),
          userHome: process.env.HOME || '/home/user'
        }
      } as any,
      effectiveConfig: {
        descriptionPrefix: 'Test'
      },
      interruptConfig: null
    };

    const decision = await adapter.resolveDecision(mockContext);
    expect(decision).toBeDefined();
  });
});
