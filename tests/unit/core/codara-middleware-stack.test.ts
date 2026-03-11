import {describe, expect, it} from 'bun:test';
import {createMiddleware} from '@core/middleware';
import {createCodaraMiddlewares} from '@core/codara/facade';

describe('Codara middleware stack', () => {
  it('should keep the default stack runtime-only', () => {
    const middlewares = createCodaraMiddlewares({});

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should place logging first, caller middlewares before budget/summary, and keep HIL last', () => {
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
      'CustomMiddleware',
      'ConversationContextMiddleware',
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
      'AliasMiddleware',
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should keep summary middleware disabled by default', () => {
    const middlewares = createCodaraMiddlewares({});

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should keep summary inside the conversation context stage so it can compact against the full prompt input', () => {
    const middlewares = createCodaraMiddlewares({
      summary: {
        summarize: () => 'summary',
      },
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should let caller middlewares contribute system messages before conversation context runs', () => {
    const custom = createMiddleware({
      name: 'CustomPromptMiddleware',
      beforeModel(context) {
        context.systemMessage.push('custom');
        return undefined;
      },
    });

    const middlewares = createCodaraMiddlewares({
      summary: {
        summarize: () => 'summary',
      },
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'CustomPromptMiddleware',
      'ConversationContextMiddleware',
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

    expect(byName.get('ConversationContextMiddleware')).toMatchObject({
      beforeModel: expect.any(Function),
    });
    expect(byName.get('ConversationContextMiddleware')?.beforeAgent).toBeUndefined();
    expect(byName.get('ConversationContextMiddleware')?.wrapModelCall).toBeUndefined();
    expect(byName.get('ConversationContextMiddleware')?.wrapToolCall).toBeUndefined();

    expect(byName.get('HumanInTheLoopMiddleware')).toMatchObject({
      wrapToolCall: expect.any(Function),
    });
    expect(byName.get('HumanInTheLoopMiddleware')?.beforeModel).toBeUndefined();
    expect(byName.get('HumanInTheLoopMiddleware')?.wrapModelCall).toBeUndefined();
    expect(byName.get('HumanInTheLoopMiddleware')?.afterAgent).toBeUndefined();
  });

  it('should not leak source-driven prompt injection back into the default runtime stack', () => {
    const middlewares = createCodaraMiddlewares({});
    const names = new Set(middlewares.map((middleware) => middleware.name));

    expect(names.has('GuidelinesMiddleware')).toBe(false);
    expect(names.has('SkillsMiddleware')).toBe(false);
  });

});
