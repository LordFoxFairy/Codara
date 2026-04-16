/** Jupyter Notebook 读取工具。 */

import {readFile} from 'node:fs/promises';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {validatePath, formatError, getErrorCode, getErrorMessage} from '@tools/utils';

// ── Notebook JSON 类型 ──────────────────────────────────────────────────

interface NotebookOutput {
  output_type: string;
  text?: string[];
  data?: Record<string, string[]>;
  ename?: string;
  evalue?: string;
  name?: string;
}

interface NotebookCell {
  cell_type: string;
  source: string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
}

interface NotebookJson {
  cells: NotebookCell[];
}

// ── 解析逻辑 ────────────────────────────────────────────────────────────

function renderOutput(output: NotebookOutput, executionCount: number | null): string {
  switch (output.output_type) {
    case 'stream': {
      const text = output.text?.join('') ?? '';
      return text;
    }
    case 'execute_result': {
      const textPlain = output.data?.['text/plain']?.join('') ?? '';
      const label = executionCount != null ? `Out [${executionCount}]: ` : 'Out: ';
      return `${label}${textPlain}`;
    }
    case 'error': {
      return `Error: ${output.ename ?? 'Unknown'}: ${output.evalue ?? ''}`;
    }
    case 'display_data': {
      const textPlain = output.data?.['text/plain']?.join('') ?? '';
      return textPlain || '(display_data: non-text output)';
    }
    default:
      return '';
  }
}

/** 解析 .ipynb JSON 为可读文本。 */
export function parseNotebook(json: NotebookJson): string {
  if (!json.cells || !Array.isArray(json.cells)) {
    return '(empty notebook)';
  }

  const sections: string[] = [];

  for (let i = 0; i < json.cells.length; i++) {
    const cell = json.cells[i]!;
    const source = cell.source.join('');

    if (cell.cell_type === 'markdown') {
      sections.push(source);
    } else if (cell.cell_type === 'code') {
      const execLabel = cell.execution_count != null ? `In [${cell.execution_count}]` : `In [ ]`;
      sections.push(`${execLabel}:\n${source}`);

      if (cell.outputs && cell.outputs.length > 0) {
        const outputTexts = cell.outputs
          .map((o) => renderOutput(o, cell.execution_count ?? null))
          .filter((t) => t.length > 0);

        if (outputTexts.length > 0) {
          sections.push(outputTexts.join('\n'));
        }
      }
    } else if (cell.cell_type === 'raw') {
      sections.push(source);
    }
  }

  return sections.join('\n\n');
}

// ── Tool 实现 ────────────────────────────────────────────────────────────

const notebookReadInputSchema = z.object({
  file_path: z.string().min(1).describe('Absolute path to the .ipynb notebook file.'),
});

type NotebookReadInput = z.infer<typeof notebookReadInputSchema>;

/** Jupyter Notebook 读取工具。 */
export class NotebookReadTool extends StructuredTool<typeof notebookReadInputSchema> {
  name = 'notebook_read';
  description = `Reads and parses a Jupyter notebook (.ipynb) file into human-readable text.
Use when: examining notebook contents, reviewing code cells and their outputs.
Returns: formatted text showing markdown cells, code cells with In/Out labels, and outputs.`;
  schema = notebookReadInputSchema;

  async _call(input: NotebookReadInput): Promise<string> {
    const filePath = input.file_path;
    const pathError = validatePath(filePath);
    if (pathError) {
      return pathError;
    }

    if (!filePath.endsWith('.ipynb')) {
      return formatError('Invalid file type', 'file must be a .ipynb notebook', filePath);
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code === 'ENOENT') {
        return formatError('File not found', filePath);
      }
      return formatError('Read failed', getErrorMessage(error));
    }

    let notebook: NotebookJson;
    try {
      notebook = JSON.parse(content) as NotebookJson;
    } catch {
      return formatError('Invalid notebook', 'failed to parse JSON', filePath);
    }

    const result = parseNotebook(notebook);
    return result || '(empty notebook)';
  }
}

/** 创建 NotebookReadTool。 */
export function createNotebookReadTool(): NotebookReadTool {
  return new NotebookReadTool();
}
