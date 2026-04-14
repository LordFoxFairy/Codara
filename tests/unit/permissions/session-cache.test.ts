import {describe, expect, it} from 'bun:test';
import {PermissionSessionCache} from '@core/middleware/permission/session-cache';

describe('PermissionSessionCache', () => {
  it('should return undefined on cache miss', () => {
    const cache = new PermissionSessionCache();
    expect(cache.lookup('Bash(git status)')).toBeUndefined();
    expect(cache.lookup('Edit(src/foo.ts)')).toBeUndefined();
  });

  it('should return cached decision on hit', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Bash(git *)', 'allow');
    expect(cache.lookup('Bash(git *)')).toBe('allow');
  });

  it('should support deny decisions', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Bash(rm *)', 'deny');
    expect(cache.lookup('Bash(rm *)')).toBe('deny');
  });

  it('should remember + lookup round-trip for tool-level keys', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Read', 'allow');
    expect(cache.lookup('Read')).toBe('allow');
  });

  it('should remember + lookup round-trip for pattern keys', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Edit(src/components/*)', 'allow');
    expect(cache.lookup('Edit(src/components/*)')).toBe('allow');
  });

  it('should overwrite previous decision for the same key', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Bash(npm *)', 'deny');
    expect(cache.lookup('Bash(npm *)')).toBe('deny');

    cache.remember('Bash(npm *)', 'allow');
    expect(cache.lookup('Bash(npm *)')).toBe('allow');
  });

  it('should clear all cached decisions', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Bash(git *)', 'allow');
    cache.remember('Edit(src/*)', 'allow');
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.lookup('Bash(git *)')).toBeUndefined();
    expect(cache.lookup('Edit(src/*)')).toBeUndefined();
  });

  it('should report correct size', () => {
    const cache = new PermissionSessionCache();
    expect(cache.size).toBe(0);

    cache.remember('Bash(git *)', 'allow');
    expect(cache.size).toBe(1);

    cache.remember('Edit(src/*)', 'deny');
    expect(cache.size).toBe(2);

    // Overwrite doesn't increase size
    cache.remember('Bash(git *)', 'deny');
    expect(cache.size).toBe(2);
  });

  it('should keep different tool expressions independent', () => {
    const cache = new PermissionSessionCache();
    cache.remember('Bash(git *)', 'allow');
    cache.remember('Bash(rm *)', 'deny');

    expect(cache.lookup('Bash(git *)')).toBe('allow');
    expect(cache.lookup('Bash(rm *)')).toBe('deny');
    expect(cache.lookup('Bash(npm *)')).toBeUndefined();
  });
});
