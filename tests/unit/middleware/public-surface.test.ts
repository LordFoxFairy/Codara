import {describe, expect, it} from 'bun:test';
import * as middleware from '@core/middleware';

describe('middleware public surface', () => {
  it('should keep low-level conversation helpers out of the main middleware barrel', () => {
    expect('createConversationContextMiddleware' in middleware).toBe(true);
    expect('createGuidelinesMiddleware' in middleware).toBe(true);
    expect('createLoggingMiddleware' in middleware).toBe(true);
    expect('createHILMiddleware' in middleware).toBe(true);
    expect('createSkillsMiddleware' in middleware).toBe(true);

    expect('createContextBudgetMiddleware' in middleware).toBe(false);
    expect('createSummaryMiddleware' in middleware).toBe(false);
    expect('refreshContextBudget' in middleware).toBe(false);
    expect('compactSummaryIfNeeded' in middleware).toBe(false);
  });
});
