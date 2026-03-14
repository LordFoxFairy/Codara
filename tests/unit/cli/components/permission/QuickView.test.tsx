// tests/unit/cli/components/permission/QuickView.test.tsx

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { QuickView } from '@/cli/components/permission/QuickView';

describe('QuickView', () => {
  it('should render tool call info', () => {
    const { lastFrame } = render(
      <QuickView
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

  it('should show action buttons', () => {
    const { lastFrame } = render(
      <QuickView
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

    expect(lastFrame()).toContain('Yes');
    expect(lastFrame()).toContain('No');
  });
});
