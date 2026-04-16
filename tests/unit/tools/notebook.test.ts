import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {parseNotebook} from '@tools/extended/notebook';
import {createNotebookReadTool} from '@tools';

describe('parseNotebook', () => {
  it('should render markdown cells as plain text', () => {
    const result = parseNotebook({
      cells: [
        {cell_type: 'markdown', source: ['# Hello\n', 'World']},
      ],
    });
    expect(result).toBe('# Hello\nWorld');
  });

  it('should render code cells with execution count', () => {
    const result = parseNotebook({
      cells: [
        {
          cell_type: 'code',
          source: ['print("hello")'],
          execution_count: 1,
          outputs: [],
        },
      ],
    });
    expect(result).toContain('In [1]:');
    expect(result).toContain('print("hello")');
  });

  it('should render code cells without execution count', () => {
    const result = parseNotebook({
      cells: [
        {
          cell_type: 'code',
          source: ['x = 1'],
          execution_count: null,
          outputs: [],
        },
      ],
    });
    expect(result).toContain('In [ ]:');
  });

  it('should render stream output', () => {
    const result = parseNotebook({
      cells: [
        {
          cell_type: 'code',
          source: ['print("hi")'],
          execution_count: 1,
          outputs: [
            {output_type: 'stream', name: 'stdout', text: ['hi\n']},
          ],
        },
      ],
    });
    expect(result).toContain('hi\n');
  });

  it('should render execute_result output', () => {
    const result = parseNotebook({
      cells: [
        {
          cell_type: 'code',
          source: ['42'],
          execution_count: 3,
          outputs: [
            {output_type: 'execute_result', data: {'text/plain': ['42']}},
          ],
        },
      ],
    });
    expect(result).toContain('Out [3]: 42');
  });

  it('should render error output', () => {
    const result = parseNotebook({
      cells: [
        {
          cell_type: 'code',
          source: ['1/0'],
          execution_count: 2,
          outputs: [
            {output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero'},
          ],
        },
      ],
    });
    expect(result).toContain('Error: ZeroDivisionError: division by zero');
  });

  it('should handle empty notebook', () => {
    expect(parseNotebook({cells: []})).toBe('');
  });

  it('should handle mixed cell types', () => {
    const result = parseNotebook({
      cells: [
        {cell_type: 'markdown', source: ['# Title']},
        {
          cell_type: 'code',
          source: ['x = 1'],
          execution_count: 1,
          outputs: [
            {output_type: 'execute_result', data: {'text/plain': ['1']}},
          ],
        },
        {cell_type: 'markdown', source: ['Some text']},
      ],
    });
    expect(result).toContain('# Title');
    expect(result).toContain('In [1]:');
    expect(result).toContain('Out [1]: 1');
    expect(result).toContain('Some text');
  });
});

describe('NotebookReadTool', () => {
  it('should read and parse a real .ipynb file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-nb-'));
    const filePath = path.join(dir, 'test.ipynb');

    const notebook = {
      cells: [
        {cell_type: 'markdown', source: ['# Test Notebook'], metadata: {}},
        {
          cell_type: 'code',
          source: ['print("hello")'],
          metadata: {},
          execution_count: 1,
          outputs: [{output_type: 'stream', name: 'stdout', text: ['hello\n']}],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };

    await writeFile(filePath, JSON.stringify(notebook), 'utf8');

    const tool = createNotebookReadTool();
    const result = await tool.invoke({file_path: filePath});
    const text = String(result);

    expect(text).toContain('# Test Notebook');
    expect(text).toContain('In [1]:');
    expect(text).toContain('print("hello")');
    expect(text).toContain('hello\n');
  });

  it('should reject non-ipynb files', async () => {
    const tool = createNotebookReadTool();
    const result = await tool.invoke({file_path: '/tmp/test.py'});
    expect(String(result)).toContain('Invalid file type');
  });

  it('should handle file not found', async () => {
    const tool = createNotebookReadTool();
    const result = await tool.invoke({file_path: '/tmp/nonexistent_notebook.ipynb'});
    expect(String(result)).toContain('File not found');
  });

  it('should handle invalid JSON', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-nb-'));
    const filePath = path.join(dir, 'bad.ipynb');
    await writeFile(filePath, 'not json at all', 'utf8');

    const tool = createNotebookReadTool();
    const result = await tool.invoke({file_path: filePath});
    expect(String(result)).toContain('Invalid notebook');
  });
});
