import {describe, expect, it} from 'bun:test';
import {
  composeCliDraftText,
  createCliCollapsedPaste,
  shouldCollapseCliPaste,
  summarizeCliCollapsedPastes,
} from '@/cli/composer/collapsed-paste';
import {createComposerState} from '@/cli/composer/state';

describe('cli collapsed paste state', () => {
  it('collapses large or multiline paste only when the visible composer is still empty', () => {
    expect(shouldCollapseCliPaste('line one\nline two', createComposerState())).toBe(true);
    expect(shouldCollapseCliPaste('x'.repeat(120), createComposerState())).toBe(true);
    expect(shouldCollapseCliPaste('line one\nline two', createComposerState('typed'))).toBe(false);
  });

  it('summarizes pasted blocks and composes the final draft text', () => {
    const first = createCliCollapsedPaste('alpha\nbeta');
    const second = createCliCollapsedPaste('gamma');

    expect(summarizeCliCollapsedPastes([first, second])).toEqual({
      blockCount: 2,
      charCount: first.charCount + second.charCount,
      lineCount: first.lineCount + second.lineCount,
    });

    expect(composeCliDraftText('Explain this', [first, second])).toBe('alpha\nbetagammaExplain this');
  });
});
