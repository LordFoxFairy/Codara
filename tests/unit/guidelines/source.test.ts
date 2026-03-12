import {describe, expect, it} from 'bun:test';
import {FileGuidelinesSource} from '@core/sessions/guidelines';

describe('FileGuidelinesSource', () => {
  it('should read the latest AGENTS content directly without source-level caching', async () => {
    let current = 'first';
    const source = new FileGuidelinesSource({
      load: async () => current,
    });

    expect(await source.getContent()).toBe('first');

    current = 'second';
    expect(await source.getContent()).toBe('second');
  });
});
