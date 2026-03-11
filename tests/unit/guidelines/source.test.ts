import {describe, expect, it} from 'bun:test';
import {FileGuidelinesSource} from '@core/instructions/guidelines';

describe('FileGuidelinesSource', () => {
  it('should keep AGENTS content stable until it is explicitly reloaded', async () => {
    let current = 'first';
    const source = new FileGuidelinesSource({
      load: async () => current,
    });

    expect(await source.getContent()).toBe('first');

    current = 'second';
    expect(await source.getContent()).toBe('first');

    source.reload();
    expect(await source.getContent()).toBe('second');
  });

  it('should honor ttl refresh when cacheTTL is configured explicitly', async () => {
    let current = 'first';
    const source = new FileGuidelinesSource({
      load: async () => current,
      cacheTTL: 0,
    });

    expect(await source.getContent()).toBe('first');

    current = 'second';
    expect(await source.getContent()).toBe('second');
  });
});
