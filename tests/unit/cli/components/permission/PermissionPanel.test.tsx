// tests/unit/cli/components/permission/PermissionPanel.test.tsx

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { PermissionPanel } from '@/cli/components/permission/PermissionPanel';

describe('PermissionPanel', () => {
  it('should render QuickView by default', () => {
    const { lastFrame } = render(
      <PermissionPanel
        toolCall={{ tool: 'Edit', input: 'src/index.ts' }}
        evaluation={{
          input: 'Edit(src/index.ts)',
          decision: 'ask',
          matched: null,
          defaultDecision: 'ask',
          sources: [],
          policySummary: { deny: 0, ask: 0, allow: 0 }
        }}
        onAction={() => {}}
      />
    );

    expect(lastFrame()).toContain('Edit');
    expect(lastFrame()).toContain('src/index.ts');
  });
});
