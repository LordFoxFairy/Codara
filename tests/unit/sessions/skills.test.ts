import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {createCodaraSkillsSource} from '@core/instructions/skills';
import type {SkillMetadata, SkillStore} from '@core/instructions/skills';

describe('Codara skills source', () => {
  it('should let source.reload invalidate both source cache and underlying store cache', async () => {
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

    source.reload();
    const second = await source.getRuntime();

    expect(refreshCount).toBe(1);
    expect(second.discovered[0]?.description).toBe('skill rule v2');
  });
});
