// tests/unit/cli/components/permission/DetailedView.test.tsx

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { DetailedView } from '@/cli/components/permission/DetailedView';

describe('DetailedView', () => {
  it('should render evaluation details', () => {
    const { lastFrame } = render(
      <DetailedView
        toolCall={{ tool: 'Bash', input: 'git status' }}
        evaluation={{
          input: 'Bash(git status)',
          decision: 'ask',
          matched: { bucket: 'ask', rule: 'Bash(*)', scope: 'codara_local' },
          defaultDecision: 'ask',
          sources: [],
          policySummary: { deny: 0, ask: 1, allow: 0 }
        }}
        bashAnalysis={{
          command: 'git status',
          normalized: 'git status',
          risk: 'low',
          operations: [],
          complexity: { hasSubshell: false, hasPipe: false, hasRedirect: false }
        }}
        onAction={() => {}}
        onBack={() => {}}
      />
    );

    expect(lastFrame()).toContain('git status');
    expect(lastFrame()).toContain('low');
  });
});
