import {describe, expect, it} from 'bun:test';
import {FileAgentsSource} from '@core/sessions/agents-source';

describe('FileAgentsSource', () => {
  it('should keep AGENTS content stable until it is explicitly reloaded', async () => {
    let current = 'first';
    const source = new FileAgentsSource({
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
    const source = new FileAgentsSource({
      load: async () => current,
      cacheTTL: 0,
    });

    expect(await source.getContent()).toBe('first');

    current = 'second';
    expect(await source.getContent()).toBe('second');
  });
});
