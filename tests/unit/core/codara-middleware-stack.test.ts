import {describe, expect, it} from 'bun:test';
import {createMiddleware} from '@core/middleware';
import {createCodaraMiddlewares} from '@codara/facade';

describe('Codara middleware stack', () => {
  it('should keep the default stack runtime-only', () => {
    const middlewares = createCodaraMiddlewares({});

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'SkillsMiddleware',
      'BudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should place logging first, caller middlewares before budget, and keep HIL last', () => {
    const custom = createMiddleware({
      name: 'CustomMiddleware',
      beforeModel: () => undefined,
    });

    const middlewares = createCodaraMiddlewares({
      logging: {enabled: true},
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'LoggingMiddleware',
      'SkillsMiddleware',
      'CustomMiddleware',
      'BudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should accept the middleware alias on the Codara facade', () => {
    const custom = createMiddleware({
      name: 'AliasMiddleware',
      beforeModel: () => undefined,
    });

    const middlewares = createCodaraMiddlewares({
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'SkillsMiddleware',
      'AliasMiddleware',
      'BudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should let caller middlewares contribute system messages before budget runs', () => {
    const custom = createMiddleware({
      name: 'CustomPromptMiddleware',
      beforeModel(context) {
        context.systemMessage.push('custom');
        return undefined;
      },
    });

    const middlewares = createCodaraMiddlewares({
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'SkillsMiddleware',
      'CustomPromptMiddleware',
      'BudgetMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should keep default middleware responsibilities non-overlapping in the main route', () => {
    const middlewares = createCodaraMiddlewares({
      logging: {enabled: true},
    });

    const byName = new Map(middlewares.map((middleware) => [middleware.name, middleware]));

    expect(byName.get('LoggingMiddleware')).toMatchObject({
      beforeAgent: expect.any(Function),
      beforeModel: expect.any(Function),
      wrapModelCall: expect.any(Function),
      afterModel: expect.any(Function),
      wrapToolCall: expect.any(Function),
      afterAgent: expect.any(Function),
    });

    expect(byName.get('BudgetMiddleware')).toMatchObject({
      beforeModel: expect.any(Function),
    });
    expect(byName.get('BudgetMiddleware')?.beforeAgent).toBeUndefined();
    expect(byName.get('BudgetMiddleware')?.wrapModelCall).toBeUndefined();
    expect(byName.get('BudgetMiddleware')?.wrapToolCall).toBeUndefined();

    expect(byName.get('SummaryMiddleware')).toBeUndefined();

    expect(byName.get('HumanInTheLoopMiddleware')).toMatchObject({
      wrapToolCall: expect.any(Function),
    });
    expect(byName.get('HumanInTheLoopMiddleware')?.beforeModel).toBeUndefined();
    expect(byName.get('HumanInTheLoopMiddleware')?.wrapModelCall).toBeUndefined();
    expect(byName.get('HumanInTheLoopMiddleware')?.afterAgent).toBeUndefined();
  });

  it('should skip SkillsMiddleware when caller already provides one', () => {
    const callerSkills = createMiddleware({
      name: 'SkillsMiddleware',
      beforeModel: () => undefined,
    });

    const middlewares = createCodaraMiddlewares({
      middleware: [callerSkills],
    });

    const skillsCount = middlewares.filter((m) => m.name === 'SkillsMiddleware').length;
    expect(skillsCount).toBe(1);
  });

  it('should not include source-driven prompt middleware in the default stack', () => {
    const middlewares = createCodaraMiddlewares({});
    const names = new Set(middlewares.map((middleware) => middleware.name));

    expect(names.has('PathInstructionsMiddleware')).toBe(false);
  });
});
