// tests/unit/core/hil/types.test.ts

import { describe, it, expect } from 'vitest';
import {
  HILReviewType,
  HILReviewStatus,
  type HILReviewRequest,
  type HILReviewResult
} from '@/core/middleware/hil/types';

describe('HIL Types', () => {
  it('should create valid review request', () => {
    const request: HILReviewRequest = {
      id: 'test-123',
      type: HILReviewType.PERMISSION,
      title: 'Test Permission',
      description: 'Test description',
      metadata: {},
      actions: [
        { id: 'allow', label: 'Allow', kind: 'primary' }
      ],
      createdAt: Date.now()
    };

    expect(request.id).toBe('test-123');
    expect(request.type).toBe(HILReviewType.PERMISSION);
  });

  it('should create valid review result', () => {
    const result: HILReviewResult = {
      reviewId: 'test-123',
      actionId: 'allow',
      status: HILReviewStatus.APPROVED,
      timestamp: Date.now()
    };

    expect(result.reviewId).toBe('test-123');
    expect(result.status).toBe(HILReviewStatus.APPROVED);
  });
});
