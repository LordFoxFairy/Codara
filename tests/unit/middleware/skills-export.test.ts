import {describe, expect, it} from 'bun:test';
import {
  createSkillsMiddleware,
  FileSystemSkillStore,
  getDefaultSkillSources,
  type SkillStore,
} from '@core/middleware';

describe('middleware unified skills exports', () => {
  it('should expose skills middleware and store helpers from @core/middleware', async () => {
    const defaults = getDefaultSkillSources({
      userHome: '/tmp/u',
      projectRoot: '/tmp/p',
    });

    expect(defaults[0]).toContain('/tmp/u');
    expect(defaults[1]).toContain('/tmp/p');

    const store: SkillStore = {
      async discover() {
        return [];
      },
      listSources() {
        return ['/tmp/p/.codara/skills'];
      },
    };

    const middleware = createSkillsMiddleware({store});
    expect(middleware.name).toBe('SkillsMiddleware');

    const fsStore = new FileSystemSkillStore({
      sources: ['/tmp/p/.codara/skills'],
      cacheTtlMs: 0,
    });
    const discovered = await fsStore.discover();
    expect(Array.isArray(discovered)).toBe(true);
  });
});
