import {describe, test, expect} from 'bun:test';
import {chunkText} from '@gateway/outbound';

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
