import {describe, expect, test} from 'bun:test';
import {
  extractMessageChunk,
  isSlashCommandPrompt,
  normalizeUserInput,
  renderChunkContent,
} from '@/cli/adapters/chunk-helpers';

describe('cli agent session helpers', () => {
  test('normalizeUserInput should trim whitespace', () => {
    expect(normalizeUserInput('  hello  ')).toBe('hello');
  });

  test('isSlashCommandPrompt should detect slash commands', () => {
    expect(isSlashCommandPrompt('/memory')).toBe(true);
    expect(isSlashCommandPrompt('fix lint')).toBe(false);
  });

  test('renderChunkContent should flatten mixed text chunks', () => {
    const content = ['hello', {text: ' world'}, {text: '!'}];
    expect(renderChunkContent(content)).toBe('hello world!');
  });

  test('extractMessageChunk should support direct and tuple payloads', () => {
    expect(extractMessageChunk({content: 'x'})).toEqual({content: 'x'});
    expect(extractMessageChunk(['messages', {content: 'y'}])).toEqual({content: 'y'});
    expect(extractMessageChunk(null)).toBeUndefined();
  });
});
