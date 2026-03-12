import {describe, expect, test} from 'bun:test';
import {
  backspaceComposerText,
  createComposerState,
  insertComposerNewline,
  insertComposerText,
  moveComposerCursorDown,
  moveComposerCursorEnd,
  moveComposerCursorHome,
  moveComposerCursorLeft,
  moveComposerCursorRight,
  moveComposerCursorUp,
} from '@/cli/composer/state';

describe('cli composer state', () => {
  test('insertComposerText should insert at cursor position', () => {
    const state = createComposerState('helo', 2);
    expect(insertComposerText(state, 'l')).toEqual({text: 'hello', cursorOffset: 3});
  });

  test('insertComposerNewline should create multi-line content', () => {
    const state = createComposerState('hello', 5);
    expect(insertComposerNewline(state)).toEqual({text: 'hello\n', cursorOffset: 6});
  });

  test('backspaceComposerText should remove before cursor', () => {
    const state = createComposerState('hello', 5);
    expect(backspaceComposerText(state)).toEqual({text: 'hell', cursorOffset: 4});
  });

  test('cursor movement should clamp within text bounds', () => {
    expect(moveComposerCursorLeft(createComposerState('abc', 0)).cursorOffset).toBe(0);
    expect(moveComposerCursorRight(createComposerState('abc', 3)).cursorOffset).toBe(3);
  });

  test('home and end should move within current line', () => {
    const state = createComposerState('ab\ncd\nef', 4);
    expect(moveComposerCursorHome(state).cursorOffset).toBe(3);
    expect(moveComposerCursorEnd(state).cursorOffset).toBe(5);
  });

  test('up and down should preserve the column when possible', () => {
    const upState = createComposerState('abc\nxy\n12345', 9);
    expect(moveComposerCursorUp(upState).cursorOffset).toBe(6);

    const downState = createComposerState('abc\nxy\n12345', 5);
    expect(moveComposerCursorDown(downState).cursorOffset).toBe(8);
  });

  test('up and down should clamp to target line length', () => {
    const upState = createComposerState('12345\nxy', 7);
    expect(moveComposerCursorUp(upState).cursorOffset).toBe(1);

    const downState = createComposerState('xy\n12345', 2);
    expect(moveComposerCursorDown(downState).cursorOffset).toBe(5);
  });
});
