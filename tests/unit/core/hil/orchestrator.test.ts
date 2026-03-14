// tests/unit/core/hil/orchestrator.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HILOrchestrator } from '@/core/middleware/hil/orchestrator';
import {
  HILReviewType,
  HILReviewStatus,
  type HILReviewHandler
} from '@/core/middleware/hil/types';

describe('HILOrchestrator', () => {
  let orchestrator: HILOrchestrator;

  beforeEach(() => {
    orchestrator = new HILOrchestrator();
  });

  it('should register handler', () => {
    const handler: HILReviewHandler = {
      type: HILReviewType.PERMISSION,
      buildReviewRequest: vi.fn(),
      handleReviewResult: vi.fn()
    };

    orchestrator.registerHandler(handler);

    expect(orchestrator.hasHandler(HILReviewType.PERMISSION)).toBe(true);
  });

  it('should throw error if handler not registered', async () => {
    await expect(
      orchestrator.requestReview(HILReviewType.PERMISSION, {}, {})
    ).rejects.toThrow('No handler registered');
  });

  it('should request review and wait for decision', async () => {
    const handler: HILReviewHandler = {
      type: HILReviewType.PERMISSION,
      buildReviewRequest: vi.fn().mockReturnValue({
        id: 'test-123',
        type: HILReviewType.PERMISSION,
        title: 'Test',
        description: 'Test',
        metadata: {},
        actions: [],
        createdAt: Date.now()
      }),
      handleReviewResult: vi.fn().mockResolvedValue('result')
    };

    orchestrator.registerHandler(handler);

    const promise = orchestrator.requestReview(
      HILReviewType.PERMISSION,
      {},
      {}
    );

    // 模拟用户决策
    setTimeout(() => {
      orchestrator.submitDecision('test-123', 'allow');
    }, 10);

    const result = await promise;

    expect(result).toBe('result');
    expect(handler.buildReviewRequest).toHaveBeenCalled();
    expect(handler.handleReviewResult).toHaveBeenCalled();
  });
});
