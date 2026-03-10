import {describe, expect, it} from 'bun:test';
import {FileSourceProvider} from '@core/sessions/source-provider';

describe('FileSourceProvider', () => {
  it('should keep source content stable until it is explicitly invalidated', async () => {
    let current = 'first';
    const provider = new FileSourceProvider({
      sources: {
        source: {
          load: async () => current,
        },
      },
    });

    expect(await provider.get('source')).toBe('first');

    current = 'second';
    expect(await provider.get('source')).toBe('first');

    provider.invalidate('source');
    expect(await provider.get('source')).toBe('second');
  });

  it('should honor ttl refresh when cacheTTL is configured explicitly', async () => {
    let current = 'first';
    const provider = new FileSourceProvider({
      sources: {
        source: {
          load: async () => current,
        },
      },
      cacheTTL: 0,
    });

    expect(await provider.get('source')).toBe('first');

    current = 'second';
    expect(await provider.get('source')).toBe('second');
  });
});
