import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {
  BashTool,
  EditTool,
  FetchTool,
  GlobTool,
  GrepTool,
  ReadTool,
  WriteTool,
  createBashTool,
  createBuiltinTools,
  createEditTool,
  createFetchTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from '@core/tools';

describe('builtin tools', () => {
  it('should create all builtin tools with stable names', () => {
    const tools = createBuiltinTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'bash',
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'fetch_url',
    ]);
    expect(tools.length).toBe(7);
  });

  it('should export class-based tools', () => {
    expect(createBashTool()).toBeInstanceOf(BashTool);
    expect(createReadTool()).toBeInstanceOf(ReadTool);
    expect(createWriteTool()).toBeInstanceOf(WriteTool);
    expect(createEditTool()).toBeInstanceOf(EditTool);
    expect(createGlobTool()).toBeInstanceOf(GlobTool);
    expect(createGrepTool()).toBeInstanceOf(GrepTool);
    expect(createFetchTool()).toBeInstanceOf(FetchTool);
  });

  it('write + read + edit should work on real files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-tools-'));
    const filePath = path.join(root, 'demo.txt');

    const write = createWriteTool();
    const read = createReadTool();
    const edit = createEditTool();

    const writeResult = await write.invoke({
      file_path: filePath,
      content: 'line1\nline2\nline3',
    });
    expect(String(writeResult)).toContain('File written:');

    const readResult = await read.invoke({file_path: filePath, offset: 1, limit: 2});
    expect(String(readResult)).toContain('2→line2');
    expect(String(readResult)).toContain('3→line3');

    const duplicatedPath = path.join(root, 'dup.txt');
    await writeFile(duplicatedPath, 'abc\nabc\nabc', 'utf8');
    const duplicateEdit = await edit.invoke({
      file_path: duplicatedPath,
      old_string: 'abc',
      new_string: 'XYZ',
    });
    expect(String(duplicateEdit)).toContain('replace_all=true');

    const editResult = await edit.invoke({
      file_path: filePath,
      old_string: 'line2',
      new_string: 'LINE2',
    });
    expect(String(editResult)).toContain('Edited');

    const after = await readFile(filePath, 'utf8');
    expect(after).toContain('LINE2');
  });

  it('read should detect binary files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-binary-'));
    const filePath = path.join(root, 'binary.bin');

    const bytes = Buffer.from([0x01, 0x00, 0x02, 0x03]);
    await writeFile(filePath, bytes);

    const read = createReadTool();
    const result = await read.invoke({file_path: filePath});

    expect(String(result)).toContain('Binary file detected');
  });

  it('glob should ignore node_modules and dot paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-glob-'));
    await mkdir(path.join(root, 'node_modules'), {recursive: true});
    await mkdir(path.join(root, '.hidden'), {recursive: true});

    const visible = path.join(root, 'visible.txt');
    const hidden = path.join(root, '.hidden', 'hidden.txt');
    const ignored = path.join(root, 'node_modules', 'ignored.txt');

    await writeFile(visible, 'ok', 'utf8');
    await writeFile(hidden, 'hidden', 'utf8');
    await writeFile(ignored, 'ignored', 'utf8');

    const glob = createGlobTool(root);
    const result = await glob.invoke({pattern: '**/*.txt'});

    expect(String(result)).toContain('visible.txt');
    expect(String(result)).not.toContain('ignored.txt');
    expect(String(result)).not.toContain('hidden.txt');
  });

  it('grep should find matches and return no-match message', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-grep-'));
    const target = path.join(root, 'grep.txt');
    await writeFile(target, 'alpha\nbeta\ngamma\nAlpha', 'utf8');

    const grep = createGrepTool(root);

    const found = await grep.invoke({pattern: 'alpha', path: target, output_mode: 'content'});
    expect(String(found).toLowerCase()).toContain('alpha');

    const notFound = await grep.invoke({
      pattern: 'not_exists_123',
      path: target,
      output_mode: 'content',
    });
    expect(String(notFound)).toContain('No results: No matches found');
  });

  it('bash should execute commands and preserve cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-bash-'));
    const sub = path.join(root, 'sub');
    await mkdir(sub);

    const bash = createBashTool(root);

    const first = await bash.invoke({command: 'echo hello_tools'});
    expect(String(first)).toContain('hello_tools');

    await bash.invoke({command: 'cd sub'});
    const second = await bash.invoke({command: 'pwd'});
    expect(String(second)).toContain(sub);
  });

  it('should handle edge cases: empty paths, special characters', async () => {
    const read = createReadTool();
    const write = createWriteTool();

    try {
      await read.invoke({file_path: ''} as never);
      expect(false).toBe(true);
    } catch (error) {
      expect(String(error)).toContain('schema');
    }

    const root = await mkdtemp(path.join(tmpdir(), 'codara-special-'));
    const specialPath = path.join(root, '文件 with spaces & emoji 🎉.txt');
    await write.invoke({file_path: specialPath, content: 'test content'});
    const readSpecial = await read.invoke({file_path: specialPath});
    expect(String(readSpecial)).toContain('test content');
  });

  it('should reject path traversal attempts', async () => {
    const read = createReadTool();
    const traversalPath = '/tmp/../etc/passwd';

    const result = await read.invoke({file_path: traversalPath});
    expect(String(result)).toContain('Error');
    expect(String(result)).toContain('traversal');
  });

  it('should handle negative offset/limit gracefully', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-negative-'));
    const filePath = path.join(root, 'test.txt');
    const write = createWriteTool();
    await write.invoke({file_path: filePath, content: 'line1\nline2\nline3'});

    const read = createReadTool();

    try {
      await read.invoke({file_path: filePath, offset: -1} as never);
      expect(false).toBe(true);
    } catch (error) {
      expect(String(error)).toContain('schema');
    }
  });
});
