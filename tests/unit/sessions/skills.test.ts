import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {createCodaraSkillsSource} from '@capability/skill';
import type {SkillMetadata, SkillStore} from '@capability/skill';
import {createSkillsRuntimeBundle} from '@context/skills/build';

describe('Codara skills source', () => {
  it('should let source.reload invalidate runtime cache and rebuild the context bundle from refreshed runtime', async () => {
    let refreshCount = 0;
    let version = 1;

    const store: SkillStore = {
      async discover(): Promise<SkillMetadata[]> {
        return [{
          name: 'demo-skill',
          description: `skill rule v${version}`,
          path: path.join(process.cwd(), '.codara', 'skills', 'demo-skill', 'SKILL.md'),
        }];
      },
      listSources() {
        return [path.join(process.cwd(), '.codara', 'skills')];
      },
      refresh() {
        refreshCount += 1;
        version = 2;
      },
    };

    const source = createCodaraSkillsSource({store});

    const first = await source.getRuntime();
    expect(first.discovered[0]?.description).toBe('skill rule v1');
    const firstBundle = createSkillsRuntimeBundle(first);
    expect(firstBundle.systemMessage).toContain('skill rule v1');
    expect(firstBundle.runtimeShared.skills.discovered[0]?.description).toBe('skill rule v1');

    source.reload();
    const second = await source.getRuntime();
    const secondBundle = createSkillsRuntimeBundle(second);

    expect(refreshCount).toBe(1);
    expect(second.discovered[0]?.description).toBe('skill rule v2');
    expect(secondBundle.systemMessage).toContain('skill rule v2');
    expect(secondBundle.runtimeShared.skills.discovered[0]?.description).toBe('skill rule v2');
  });
});
