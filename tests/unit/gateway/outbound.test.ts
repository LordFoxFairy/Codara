import {describe, test, expect} from 'bun:test';
import {chunkText, chunkMarkdown} from '@gateway/outbound';

describe('chunkText', () => {
  test('returns single chunk when text fits', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  test('returns empty string as single chunk', () => {
    expect(chunkText('', 100)).toEqual(['']);
  });

  test('splits at newline boundary', () => {
    const text = 'line1\nline2\nline3';
    const chunks = chunkText(text, 10);
    expect(chunks[0]).toBe('line1');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n').replace(/\n+/g, '\n')).toContain('line2');
  });

  test('splits at space when no newline found', () => {
    const text = 'hello world foo bar';
    const chunks = chunkText(text, 12);
    expect(chunks[0]).toBe('hello world');
    expect(chunks[1]).toBe('foo bar');
  });

  test('hard splits when no whitespace found', () => {
    const text = 'abcdefghijklmnop';
    const chunks = chunkText(text, 5);
    expect(chunks[0]).toBe('abcde');
    expect(chunks[1]).toBe('fghij');
  });

  test('handles exact limit length', () => {
    const text = 'abcde';
    expect(chunkText(text, 5)).toEqual(['abcde']);
  });
});

describe('chunkMarkdown', () => {
  test('returns single chunk when text fits', () => {
    expect(chunkMarkdown('hello world', {limit: 100})).toEqual(['hello world']);
  });

  test('preserves code blocks — keeps intact when fits', () => {
    const text = 'Intro paragraph.\n\n```typescript\nconst x = 1;\nconst y = 2;\n```\n\nAnother paragraph.';
    const chunks = chunkMarkdown(text, {limit: 200});
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain('```typescript');
    expect(chunks[0]).toContain('const x = 1;');
  });

  test('does not split inside code block when it fits in one chunk', () => {
    const code = '```js\nline1\nline2\nline3\n```';
    const text = `Before.\n\n${code}\n\nAfter.`;
    // Limit large enough for code block but not everything
    const chunks = chunkMarkdown(text, {limit: code.length + 5});
    // Code block should be in exactly one chunk
    const codeChunk = chunks.find((c) => c.includes('```js'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.includes('line1')).toBe(true);
    expect(codeChunk!.includes('line3')).toBe(true);
  });

  test('splits long code block at line boundaries with fences', () => {
    const lines = Array.from({length: 20}, (_, i) => `const v${i} = ${i};`);
    const code = '```js\n' + lines.join('\n') + '\n```';
    const chunks = chunkMarkdown(code, {limit: 80});
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should have opening and closing fences
    for (const chunk of chunks) {
      expect(chunk.startsWith('```js')).toBe(true);
      expect(chunk.endsWith('```')).toBe(true);
    }
  });

  test('preserves list — keeps together when fits', () => {
    const text = 'Header\n\n- item 1\n- item 2\n- item 3\n\nFooter';
    const chunks = chunkMarkdown(text, {limit: 200});
    expect(chunks.length).toBe(1);
  });

  test('splits list from surrounding text when needed', () => {
    const text = 'A long header paragraph here.\n\n- item 1\n- item 2\n- item 3\n\nA long footer paragraph here.';
    const chunks = chunkMarkdown(text, {limit: 50});
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('continuation markers added when enabled', () => {
    const text = 'Paragraph one is here.\n\nParagraph two is here.';
    const chunks = chunkMarkdown(text, {limit: 30, continuationMarkers: true});
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk ends with ⋯
    expect(chunks[0]!.endsWith('\n⋯')).toBe(true);
    // Last chunk starts with ⋯
    expect(chunks[chunks.length - 1]!.startsWith('⋯\n')).toBe(true);
  });

  test('no continuation markers by default', () => {
    const text = 'Paragraph one is here.\n\nParagraph two is here.';
    const chunks = chunkMarkdown(text, {limit: 30});
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.includes('⋯')).toBe(false);
  });

  test('numbered list kept together', () => {
    const text = '1. First\n2. Second\n3. Third';
    const chunks = chunkMarkdown(text, {limit: 200});
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
  });
});
