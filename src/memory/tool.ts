import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {MemoryWriter} from './writer';
import type {MemoryReader} from './reader';

export const MEMORY_WRITE_TOOL_NAME = 'MemoryWrite';
export const MEMORY_READ_TOOL_NAME = 'MemoryRead';
export const MEMORY_LIST_TOOL_NAME = 'MemoryList';

const MemoryTypeSchema = z.enum(['user', 'feedback', 'project', 'reference']);

export interface MemoryToolOptions {
  writer: MemoryWriter;
}

export interface MemoryReadToolOptions {
  reader: MemoryReader;
}

export function createMemoryWriteTool(options: MemoryToolOptions): StructuredToolInterface {
  return tool(
    async ({name, description, type, content}) => {
      const filePath = await options.writer.write({name, description, type, content});
      return `Memory saved: ${name} (${type}) -> ${filePath}`;
    },
    {
      name: MEMORY_WRITE_TOOL_NAME,
      description:
        'Persist a memory for future sessions. Use this to save important context, decisions, user preferences, feedback, or reference material that should be available across sessions.',
      schema: z.object({
        name: z.string().min(1).describe('Short identifier for the memory (used as filename)'),
        description: z.string().min(1).describe('One-line summary of what this memory contains'),
        type: MemoryTypeSchema.describe(
          'Category: user (preferences/settings), feedback (corrections/lessons), project (architecture/decisions), reference (docs/specs)',
        ),
        content: z.string().min(1).describe('Full memory content in Markdown format'),
      }),
    },
  );
}

export function createMemoryReadTool(options: MemoryReadToolOptions): StructuredToolInterface {
  return tool(
    async ({name}) => {
      const memory = await options.reader.read(name);
      if (!memory) {
        return `Memory not found: ${name}`;
      }
      return [
        `# ${memory.name}`,
        `**Type:** ${memory.type}`,
        `**Description:** ${memory.description}`,
        '',
        memory.content,
      ].join('\n');
    },
    {
      name: MEMORY_READ_TOOL_NAME,
      description:
        'Read a specific memory by name. Returns the full content including metadata. Use MemoryList first to discover available memory names.',
      schema: z.object({
        name: z.string().min(1).describe('Name identifier of the memory to read'),
      }),
    },
  );
}

export function createMemoryListTool(options: MemoryReadToolOptions): StructuredToolInterface {
  return tool(
    async ({query}) => {
      const headers = query
        ? await options.reader.search(query)
        : await options.reader.list();

      if (headers.length === 0) {
        return query
          ? `No memories found matching: ${query}`
          : 'No memories stored yet.';
      }

      const lines = headers.map((h) => {
        const tag = h.type ? `[${h.type}]` : '';
        return `- ${tag} **${h.name}**: ${h.description}`;
      });

      return lines.join('\n');
    },
    {
      name: MEMORY_LIST_TOOL_NAME,
      description:
        'List all stored memories with their descriptions, or search memories by keyword. Returns name, type, and description for each memory.',
      schema: z.object({
        query: z.string().optional().describe(
          'Optional keyword to search memories. If omitted, lists all memories.',
        ),
      }),
    },
  );
}
