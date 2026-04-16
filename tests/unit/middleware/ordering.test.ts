import {describe, test, expect} from 'bun:test';
import {MiddlewarePipeline} from '@core/pipeline';
import type {BaseMiddleware} from '@core/pipeline-types';

/** Minimal middleware stub — must have at least one hook to pass createMiddleware(). */
function stub(name: string, dependsOn?: readonly string[]): BaseMiddleware {
  return {
    name,
    dependsOn,
    beforeAgent: () => {},
  };
}

describe('Middleware ordering (dependsOn)', () => {
  test('throws if dependsOn target is missing', () => {
    expect(() => new MiddlewarePipeline([stub('a', ['nonexistent'])])).toThrow(
      /depends on.*nonexistent.*which is not registered/
    );
  });

  test('throws if dependsOn target is registered after dependent', () => {
    expect(() => new MiddlewarePipeline([stub('a', ['b']), stub('b')])).toThrow(
      /must be registered before/
    );
  });

  test('accepts valid ordering', () => {
    expect(() => new MiddlewarePipeline([stub('a'), stub('b', ['a'])])).not.toThrow();
  });

  test('accepts middleware without dependsOn', () => {
    expect(() => new MiddlewarePipeline([stub('a')])).not.toThrow();
  });
});
