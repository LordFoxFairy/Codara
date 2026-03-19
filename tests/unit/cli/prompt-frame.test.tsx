import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import React from 'react';
import {PromptFrame} from '@/cli/components/prompt/prompt-frame';
import {createComposerState} from '@/cli/composer/state';

describe('cli prompt frame', () => {
  it('shows a collapsed paste summary above the prompt', () => {
    const {lastFrame} = render(
      <PromptFrame
        composer={createComposerState()}
        hasDraftContent={true}
        collapsedPasteSummary={{blockCount: 1, charCount: 128, lineCount: 4}}
        cursorActivityVersion={0}
        isRunning={false}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('[paste]');
    expect(frame).toContain('128 chars');
    expect(frame).toContain('4 lines');
    expect(frame).toContain('collapsed above prompt');
  });

  it('keeps long typed content expanded instead of rendering overflow ellipses', () => {
    const typed = Array.from({length: 10}, (_, index) => `line-${index + 1}`).join('\n');
    const {lastFrame} = render(
      <PromptFrame
        composer={createComposerState(typed)}
        hasDraftContent={true}
        cursorActivityVersion={0}
        isRunning={false}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('line-10');
    expect(frame).not.toContain('...');
  });
});
