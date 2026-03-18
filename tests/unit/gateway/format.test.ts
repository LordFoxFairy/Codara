import {describe, test, expect} from 'bun:test';
import {adaptMarkdown} from '@gateway/format';

describe('adaptMarkdown', () => {
  describe('telegram', () => {
    test('converts bold', () => {
      expect(adaptMarkdown('**hello**', 'telegram')).toBe('<b>hello</b>');
    });

    test('converts italic', () => {
      expect(adaptMarkdown('*hello*', 'telegram')).toBe('<i>hello</i>');
    });

    test('converts inline code', () => {
      expect(adaptMarkdown('use `npm install`', 'telegram')).toBe('use <code>npm install</code>');
    });

    test('converts code block', () => {
      const input = '```js\nconst x = 1;\n```';
      const output = adaptMarkdown(input, 'telegram');
      expect(output).toContain('<pre>');
      expect(output).toContain('const x = 1;');
      expect(output).toContain('language-js');
    });

    test('converts strikethrough', () => {
      expect(adaptMarkdown('~~deleted~~', 'telegram')).toBe('<s>deleted</s>');
    });

    test('converts links', () => {
      expect(adaptMarkdown('[click](https://example.com)', 'telegram')).toBe(
        '<a href="https://example.com">click</a>',
      );
    });

    test('escapes HTML entities', () => {
      expect(adaptMarkdown('a < b & c > d', 'telegram')).toBe('a &lt; b &amp; c &gt; d');
    });

    test('handles bold + italic', () => {
      expect(adaptMarkdown('***both***', 'telegram')).toBe('<b><i>both</i></b>');
    });
  });

  describe('slack', () => {
    test('converts bold', () => {
      expect(adaptMarkdown('**hello**', 'slack')).toBe('*hello*');
    });

    test('converts italic', () => {
      expect(adaptMarkdown('*hello*', 'slack')).toBe('_hello_');
    });

    test('keeps inline code as-is', () => {
      expect(adaptMarkdown('use `npm install`', 'slack')).toBe('use `npm install`');
    });

    test('converts strikethrough', () => {
      expect(adaptMarkdown('~~deleted~~', 'slack')).toBe('~deleted~');
    });

    test('converts links', () => {
      expect(adaptMarkdown('[click](https://example.com)', 'slack')).toBe('<https://example.com|click>');
    });

    test('keeps code blocks as-is', () => {
      const input = '```\ncode\n```';
      expect(adaptMarkdown(input, 'slack')).toBe(input);
    });

    test('handles bold + italic', () => {
      expect(adaptMarkdown('***both***', 'slack')).toBe('*_both_*');
    });
  });

  describe('pass-through platforms', () => {
    for (const platform of ['discord', 'feishu', 'dingtalk', 'wecom', 'qq']) {
      test(`${platform} returns text unchanged`, () => {
        const text = '**bold** *italic* `code` [link](url)';
        expect(adaptMarkdown(text, platform)).toBe(text);
      });
    }
  });
});
