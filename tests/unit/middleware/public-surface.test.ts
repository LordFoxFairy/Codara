import {describe, expect, it} from 'bun:test';
import * as middleware from '@core/middleware';

describe('middleware public surface', () => {
  it('should expose first-class budget and summary middleware builders, but keep low-level helpers internal', () => {
    expect('createBudgetMiddleware' in middleware).toBe(true);
    expect('createLoggingMiddleware' in middleware).toBe(true);
    expect('createHILMiddleware' in middleware).toBe(true);
    expect('createSummaryMiddleware' in middleware).toBe(true);
    expect('createSkillsMiddleware' in middleware).toBe(true);

    expect('createConversationContextMiddleware' in middleware).toBe(false);
    expect('createContextBudgetSnapshot' in middleware).toBe(false);
    expect('refreshContextBudget' in middleware).toBe(false);
    expect('compactSummaryIfNeeded' in middleware).toBe(false);
  });

  it('should keep tasks domain middlewares out of the generic middleware barrel', () => {
    expect('createTaskMiddleware' in middleware).toBe(false);
    expect('createSubagentMiddleware' in middleware).toBe(false);
    expect('createSharedTaskMiddleware' in middleware).toBe(false);
  });

  it('should keep the middleware executor internal', () => {
    expect('MiddlewarePipeline' in middleware).toBe(false);
  });
});
