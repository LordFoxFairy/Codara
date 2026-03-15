// tests/unit/cli/components/permission/PermissionPanel.test.tsx

import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {PermissionPanel} from '@/cli/components/permission/PermissionPanel';

describe('PermissionPanel', () => {
  it('should render tool call display in prompt stage', () => {
    const { lastFrame } = render(
      <PermissionPanel
        toolName="Edit"
        toolArgs={{ file_path: 'src/index.ts' }}
        evaluation={{
          input: 'Edit(src/index.ts)',
          decision: 'ask',
          matchedRule: null,
          matched: null,
          defaultDecision: 'ask',
          sources: [],
          ruleSummary: {total: 0},
        }}
        onReply={() => {}}
      />
    );

    expect(lastFrame()).toContain('Edit');
    expect(lastFrame()).toContain('src/index.ts');
  });
});
