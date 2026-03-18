import {describe, expect, it} from 'bun:test';
import {createMiddleware} from '@core/middleware';

describe('createMiddleware', () => {
  it('should normalize name and freeze middleware object', () => {
    const middleware = createMiddleware({
      name: '  trace  ',
      beforeModel: () => undefined
    });

    expect(middleware.name).toBe('trace');
    expect(Object.isFrozen(middleware)).toBe(true);
  });

  it('should require non-empty name', () => {
    expect(() => createMiddleware({
      name: '   ',
      beforeModel: () => undefined
    })).toThrow('name cannot be empty');
  });

  it('should require at least one lifecycle hook', () => {
    expect(() => createMiddleware({
      name: 'empty'
    })).toThrow('must define at least one lifecycle hook');
  });
});
