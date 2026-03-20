import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {MarkdownText} from '../../../src/cli/components/conversation/markdown-text';

describe('markdown text', () => {
  it('renders headings, lists, blockquotes, and code blocks in a readable terminal form', () => {
    const {lastFrame} = render(
      <MarkdownText content={`# Title\n\n- first item\n- second item\n\n> quoted line\n\n\`\`\`ts\nconst value = 1;\n\`\`\``} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('Title');
    expect(frame).toContain('- first item');
    expect(frame).toContain('- second item');
    expect(frame).toContain('> quoted line');
    expect(frame).toContain('const value = 1;');
  });

  it('keeps wrapped paragraph and list continuation text readable during streaming-style markdown', () => {
    const {lastFrame} = render(
      <MarkdownText
        content={[
          '第一段内容',
          '仍然属于同一段。',
          '',
          '- 列表第一项',
          '  补充说明继续跟在后面',
          '> 引用第一行',
          '> 引用第二行',
        ].join('\n')}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('第一段内容 仍然属于同一段。');
    expect(frame).toContain('- 列表第一项 补充说明继续跟在后面');
    expect(frame).toContain('> 引用第一行 引用第二行');
  });

  it('treats standalone bold lines as headings and supports ordered items without a space after the dot', () => {
    const {lastFrame} = render(
      <MarkdownText
        content={[
          '**Codara 项目改动分析报告**',
          '',
          '**具体改动内容**',
          '',
          '1.宿主层简化 (shell-app.tsx)',
          '2.控制器层瘦身 (use-cli-controller.ts)',
        ].join('\n')}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('Codara 项目改动分析报告');
    expect(frame).toContain('具体改动内容');
    expect(frame).not.toContain('**Codara 项目改动分析报告**');
    expect(frame).toContain('1. 宿主层简化 (shell-app.tsx)');
    expect(frame).toContain('2. 控制器层瘦身 (use-cli-controller.ts)');
  });
});
