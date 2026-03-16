import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {readFileSync, writeFileSync} from 'node:fs';

export const MultiEditTool = 'multi_edit';

const EditOperationSchema = z.object({
  file_path: z.string().describe('Absolute path to the file'),
  old_string: z.string().describe('Exact text to find and replace'),
  new_string: z.string().describe('Replacement text'),
});

const multiEditSchema = z.object({
  edits: z.array(EditOperationSchema).describe('Array of edit operations to apply atomically'),
});

type MultiEditInput = z.infer<typeof multiEditSchema>;

class MultiEditStructuredTool extends StructuredTool<typeof multiEditSchema> {
  name = MultiEditTool;
  description = 'Apply multiple file edits in a single atomic operation. Each edit replaces an exact string match. All edits are validated before any are applied.';
  schema = multiEditSchema;

  async _call(input: MultiEditInput): Promise<string> {
    const {edits} = input;

    const fileContents = new Map<string, string>();
    for (const edit of edits) {
      if (!fileContents.has(edit.file_path)) {
        try {
          fileContents.set(edit.file_path, readFileSync(edit.file_path, 'utf-8'));
        } catch (err: any) {
          return `Error: Cannot read ${edit.file_path}: ${err.message}`;
        }
      }
      const content = fileContents.get(edit.file_path)!;
      if (!content.includes(edit.old_string)) {
        return `Error: old_string not found in ${edit.file_path}. Edit not applied.`;
      }
      fileContents.set(edit.file_path, content.replace(edit.old_string, edit.new_string));
    }

    for (const [filePath, content] of fileContents) {
      writeFileSync(filePath, content, 'utf-8');
    }

    return `Applied ${edits.length} edit(s) across ${fileContents.size} file(s).`;
  }
}

export function createMultiEditTool(): StructuredTool {
  return new MultiEditStructuredTool();
}
