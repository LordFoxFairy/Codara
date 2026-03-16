import {describe, test, expect} from 'bun:test';
import {MultiEditTool, createMultiEditTool} from '@capability/tool/builtin/multi-edit';
import {writeFileSync, readFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

describe('MultiEdit tool', () => {
  test('tool name is multi_edit', () => {
    expect(MultiEditTool).toBe('multi_edit');
  });

  test('applies multiple edits atomically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'multi-edit-'));
    const file = join(dir, 'test.txt');
    writeFileSync(file, 'hello world\nfoo bar');

    const tool = createMultiEditTool();
    const result = await tool.invoke({
      edits: [
        {file_path: file, old_string: 'hello', new_string: 'hi'},
        {file_path: file, old_string: 'foo', new_string: 'baz'},
      ],
    });

    expect(result).toContain('Applied 2 edit(s)');
    expect(readFileSync(file, 'utf-8')).toBe('hi world\nbaz bar');
  });

  test('fails if old_string not found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'multi-edit-'));
    const file = join(dir, 'test.txt');
    writeFileSync(file, 'hello world');

    const tool = createMultiEditTool();
    const result = await tool.invoke({
      edits: [{file_path: file, old_string: 'nonexistent', new_string: 'replacement'}],
    });

    expect(result).toContain('Error');
    expect(readFileSync(file, 'utf-8')).toBe('hello world');
  });
});
