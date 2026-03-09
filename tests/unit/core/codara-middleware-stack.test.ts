import {describe, expect, it} from 'bun:test';
import {createMiddleware} from '@core/middleware';
import {createCodaraMiddlewares} from '@core';
import {EmptySkillStore} from './codara-fixtures';

describe('Codara middleware stack', () => {
  it('should include SkillsMiddleware by default', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'MemoryMiddleware',
      'SkillsMiddleware',
      'ContextBudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should place logging first, caller middlewares before HIL, and keep HIL last', () => {
    const custom = createMiddleware({
      name: 'CustomMiddleware',
      beforeModel: () => undefined,
    });

    const middlewares = createCodaraMiddlewares({
      logging: {enabled: true},
      skills: {store: new EmptySkillStore()},
      middlewares: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'LoggingMiddleware',
      'GuidelinesMiddleware',
      'MemoryMiddleware',
      'SkillsMiddleware',
      'ContextBudgetMiddleware',
      'CustomMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should accept the middleware alias on the Codara facade', () => {
    const custom = createMiddleware({
      name: 'AliasMiddleware',
      beforeModel: () => undefined,
    });

    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'MemoryMiddleware',
      'SkillsMiddleware',
      'ContextBudgetMiddleware',
      'AliasMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should keep summary middleware disabled by default', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'MemoryMiddleware',
      'SkillsMiddleware',
      'ContextBudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should place summary middleware after skills so it can compact against the full prompt input', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
      summary: {
        summarize: () => 'summary',
      },
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'MemoryMiddleware',
      'SkillsMiddleware',
      'ContextBudgetMiddleware',
      'SummaryMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should allow memory middleware to be disabled explicitly', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
      memory: false,
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'SkillsMiddleware',
      'ContextBudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });
});
