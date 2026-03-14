// src/core/hil/orchestrator.ts

import { EventEmitter } from 'events';
import {
  HILReviewType,
  HILReviewStatus,
  type HILReviewHandler,
  type HILReviewRequest,
  type HILReviewResult
} from './types';

export class HILOrchestrator extends EventEmitter {
  private handlers = new Map<HILReviewType, HILReviewHandler>();
  private activeReviews = new Map<string, HILReviewRequest>();
  private decisionCallbacks = new Map<
    string,
    (result: HILReviewResult) => void
  >();

  registerHandler(handler: HILReviewHandler): void {
    this.handlers.set(handler.type, handler);
  }

  hasHandler(type: HILReviewType): boolean {
    return this.handlers.has(type);
  }

  async requestReview<T>(
    type: HILReviewType,
    context: unknown,
    metadata: unknown
  ): Promise<T> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for type: ${type}`);
    }

    const request = handler.buildReviewRequest(context, metadata);
    this.activeReviews.set(request.id, request);

    const result = await this.waitForUserDecision(request);

    const output = await handler.handleReviewResult(request, result, context);

    this.activeReviews.delete(request.id);

    return output as T;
  }

  private async waitForUserDecision(
    request: HILReviewRequest
  ): Promise<HILReviewResult> {
    return new Promise((resolve) => {
      this.notifyUI(request);
      this.decisionCallbacks.set(request.id, resolve);
    });
  }

  private notifyUI(request: HILReviewRequest): void {
    this.emit('review:requested', request);
  }

  submitDecision(reviewId: string, actionId: string, payload?: unknown): void {
    const callback = this.decisionCallbacks.get(reviewId);
    if (callback) {
      callback({
        reviewId,
        actionId,
        status: this.getStatusFromAction(actionId),
        payload,
        timestamp: Date.now()
      });
      this.decisionCallbacks.delete(reviewId);
    }
  }

  cancelReview(reviewId: string): void {
    const callback = this.decisionCallbacks.get(reviewId);
    if (callback) {
      callback({
        reviewId,
        actionId: 'cancel',
        status: HILReviewStatus.CANCELLED,
        timestamp: Date.now()
      });
      this.decisionCallbacks.delete(reviewId);
    }

    this.activeReviews.delete(reviewId);
    this.emit('review:cancelled', reviewId);
  }

  private getStatusFromAction(actionId: string): HILReviewStatus {
    if (actionId === 'deny' || actionId === 'reject') {
      return HILReviewStatus.REJECTED;
    }
    if (actionId === 'cancel') {
      return HILReviewStatus.CANCELLED;
    }
    return HILReviewStatus.APPROVED;
  }

  getActiveReviews(): HILReviewRequest[] {
    return Array.from(this.activeReviews.values());
  }
}
