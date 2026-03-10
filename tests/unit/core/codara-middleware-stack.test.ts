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
      'SkillsMiddleware',
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
      skills: {store: new EmptySkillStore()},
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'LoggingMiddleware',
      'GuidelinesMiddleware',
      'SkillsMiddleware',
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
      skills: {store: new EmptySkillStore()},
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'SkillsMiddleware',
      'AliasMiddleware',
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should keep summary middleware disabled by default', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'SkillsMiddleware',
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should keep summary inside the conversation context stage so it can compact against the full prompt input', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
      summary: {
        summarize: () => 'summary',
      },
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'SkillsMiddleware',
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
      skills: {store: new EmptySkillStore()},
      summary: {
        summarize: () => 'summary',
      },
      middleware: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'GuidelinesMiddleware',
      'SkillsMiddleware',
      'CustomPromptMiddleware',
      'ConversationContextMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

});
