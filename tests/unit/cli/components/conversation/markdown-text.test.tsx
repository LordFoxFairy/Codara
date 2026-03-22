import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {MarkdownText} from '../../../../../src/cli/components/conversation/markdown-text';

describe('MarkdownText', () => {
  it('renders headings with terminal-friendly emphasis', () => {
    const {lastFrame} = render(<MarkdownText content={'# Top\n## Section\n#### Detail'} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Top');
    expect(frame).toContain('═══');
    expect(frame).toContain('Section');
    expect(frame).toContain('───');
    expect(frame).toContain('Detail');
  });

  it('renders pipe tables with header, separator, and body rows', () => {
    const {lastFrame} = render(
      <MarkdownText
        content={[
          '| Layer | Owns |',
          '| ----- | ---- |',
          '| CLI | UI |',
          '| Core | Runtime |',
        ].join('\n')}
      />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('| Layer | Owns    |');
    expect(frame).toContain('|-------|---------|');
    expect(frame).toContain('| CLI   | UI      |');
    expect(frame).toContain('| Core  | Runtime |');
  });

  it('renders indented headings and pipe tables instead of leaving raw markdown visible', () => {
    const {lastFrame} = render(
      <MarkdownText
        content={[
          '  #### Detail',
          '    | Layer | Owns |',
          '    | ----- | ---- |',
          '    | CLI | UI |',
        ].join('\n')}
      />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Detail');
    expect(frame).toContain('| Layer | Owns |');
    expect(frame).not.toContain('#### Detail');
    expect(frame).not.toContain('    | CLI | UI |');
  });
});
