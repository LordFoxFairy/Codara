import {describe, expect, it} from 'bun:test';
import {DynamicSectionRegistry, SYSTEM_PROMPT_DYNAMIC_BOUNDARY} from '@context/sections/dynamic';

describe('DynamicSectionRegistry', () => {
  it('should register and resolve sections', async () => {
    const registry = new DynamicSectionRegistry();
    registry.register('git', () => 'Branch: main');
    registry.register('memory', () => 'User prefers TDD');
    const sections = await registry.resolve();
    expect(sections).toEqual(['Branch: main', 'User prefers TDD']);
  });

  it('should skip undefined/empty sections', async () => {
    const registry = new DynamicSectionRegistry();
    registry.register('git', () => 'Branch: main');
    registry.register('empty', () => undefined);
    registry.register('blank', () => '  ');
    const sections = await registry.resolve();
    expect(sections).toEqual(['Branch: main']);
  });

  it('should handle async providers', async () => {
    const registry = new DynamicSectionRegistry();
    registry.register('async', async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'Async content';
    });
    const sections = await registry.resolve();
    expect(sections).toEqual(['Async content']);
  });

  it('should silently skip failing providers', async () => {
    const registry = new DynamicSectionRegistry();
    registry.register('good', () => 'OK');
    registry.register('bad', () => { throw new Error('fail'); });
    const sections = await registry.resolve();
    expect(sections).toEqual(['OK']);
  });

  it('should unregister sections', async () => {
    const registry = new DynamicSectionRegistry();
    registry.register('git', () => 'Branch: main');
    registry.unregister('git');
    const sections = await registry.resolve();
    expect(sections).toEqual([]);
  });

  it('should have DYNAMIC boundary constant', () => {
    expect(SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBe('<!-- DYNAMIC -->');
  });
});
