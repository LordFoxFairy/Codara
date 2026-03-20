import {describe, expect, test} from 'bun:test';
import {resolvePromptInputAction} from '@/cli/hooks/prompt-input-action';

describe('cli prompt input action', () => {
  test('should map ctrl+c and escape to exit', () => {
    expect(resolvePromptInputAction('c', {ctrl: true})).toBe('exit');
    expect(resolvePromptInputAction('', {escape: true})).toBe('exit');
  });

  test('should support multiple newline shortcuts', () => {
    expect(resolvePromptInputAction('j', {ctrl: true})).toBe('insert-newline');
    expect(resolvePromptInputAction('', {return: true, shift: true})).toBe('insert-newline');
    expect(resolvePromptInputAction('', {return: true, meta: true})).toBe('insert-newline');
  });

  test('should keep plain enter as submit', () => {
    expect(resolvePromptInputAction('', {return: true})).toBe('submit');
    expect(resolvePromptInputAction('\r', {return: true})).toBe('submit');
    expect(resolvePromptInputAction('\n', {return: true})).toBe('submit');
  });

  test('should treat bare newline chunks without enter metadata as pasted text', () => {
    expect(resolvePromptInputAction('\n', {})).toBe('insert-text');
    expect(resolvePromptInputAction('\r', {})).toBe('insert-text');
  });

  test('should treat pasted chunks with enter metadata as text when they contain content', () => {
    expect(resolvePromptInputAction('line 1\nline 2', {return: true})).toBe('insert-text');
  });

  test('should treat delete key as backspace for current terminal compatibility', () => {
    expect(resolvePromptInputAction('', {delete: true})).toBe('backspace');
  });

  test('should map backspace fallback to ctrl+h and backspace character', () => {
    expect(resolvePromptInputAction('', {backspace: true})).toBe('backspace');
    expect(resolvePromptInputAction('h', {ctrl: true})).toBe('backspace');
    expect(resolvePromptInputAction('\b', {})).toBe('backspace');
  });

  test('should support ctrl+a and ctrl+e as line navigation aliases', () => {
    expect(resolvePromptInputAction('a', {ctrl: true})).toBe('move-home');
    expect(resolvePromptInputAction('e', {ctrl: true})).toBe('move-end');
  });

  test('should treat plain text as insert action', () => {
    expect(resolvePromptInputAction('x', {})).toBe('insert-text');
  });

  test('should treat multi-line paste payloads as text instead of submit', () => {
    expect(resolvePromptInputAction('line 1\nline 2', {})).toBe('insert-text');
  });
});
