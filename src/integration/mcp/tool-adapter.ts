import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {McpManager, McpToolDefinition} from './types';
import {parseNamespacedToolName} from './types';
import type {McpProgressCallback} from './client';

export interface CreateMcpLangChainToolsOptions {
  /** Optional progress callback fired at the start/end of each MCP tool call. */
  onProgress?: McpProgressCallback;
}

/**
 * Convert MCP tools into LangChain StructuredToolInterface instances.
 *
 * Each tool is namespaced as `mcp__{server}__{tool}` and routes through
 * the MCP manager for execution.
 */
export function createMcpLangChainTools(
  manager: McpManager,
  options?: CreateMcpLangChainToolsOptions,
): StructuredToolInterface[] {
  const mcpTools = manager.getTools();
  return mcpTools.map((mcpTool) => createSingleMcpTool(manager, mcpTool, options?.onProgress));
}

function createSingleMcpTool(
  manager: McpManager,
  mcpTool: McpToolDefinition,
  onProgress?: McpProgressCallback,
): StructuredToolInterface {
  const parsed = parseNamespacedToolName(mcpTool.name);

  return tool(
    async (args: Record<string, unknown>) => {
      if (!parsed) {
        return `Error: invalid MCP tool name "${mcpTool.name}"`;
      }

      try { onProgress?.({phase: 'start', toolName: parsed.toolName, serverName: parsed.serverName}); } catch { /* fail-open */ }

      try {
        const result = await manager.callTool(parsed.serverName, parsed.toolName, args);
        try { onProgress?.({phase: 'end', toolName: parsed.toolName, serverName: parsed.serverName}); } catch { /* fail-open */ }
        return formatMcpResult(result);
      } catch (error) {
        try { onProgress?.({phase: 'end', toolName: parsed.toolName, serverName: parsed.serverName}); } catch { /* fail-open */ }
        return `MCP tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: mcpTool.name,
      description: mcpTool.description ?? mcpTool.name,
      // Use z.object with passthrough for dynamic MCP schemas
      schema: jsonSchemaToZod(mcpTool.inputSchema),
    },
  );
}

/**
 * Convert a JSON Schema object to a Zod schema.
 *
 * MCP tools define their input as JSON Schema. LangChain needs Zod.
 * This does a best-effort conversion for common patterns.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  if (!schema || typeof schema !== 'object') {
    return z.object({}).loose();
  }

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) ?? [];

  if (!properties || typeof properties !== 'object') {
    return z.object({}).loose();
  }

  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema = jsonSchemaPropertyToZod(prop);

    if (prop.description && typeof prop.description === 'string') {
      fieldSchema = fieldSchema.describe(prop.description);
    }

    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape).loose();
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodType {
  // --- oneOf / anyOf → z.union() ---
  const oneOf = prop.oneOf as Record<string, unknown>[] | undefined;
  const anyOf = prop.anyOf as Record<string, unknown>[] | undefined;
  const variants = oneOf ?? anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    if (variants.length === 1) {
      return jsonSchemaPropertyToZod(variants[0]!);
    }
    const schemas = variants.map((v) => jsonSchemaPropertyToZod(v));
    return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  // --- enum (works for any type, not just string) ---
  if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
    // z.enum only works for strings; for mixed types use z.union of z.literal
    const allStrings = prop.enum.every((v): v is string => typeof v === 'string');
    if (allStrings) {
      return z.enum(prop.enum as [string, ...string[]]);
    }
    const literals = prop.enum.map((v) => z.literal(v as string | number | boolean | bigint | null | undefined));
    return z.union(literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  // --- $ref — graceful skip (would need full resolver for proper support) ---
  if (prop.$ref) {
    return z.unknown();
  }

  const type = prop.type as string | undefined;

  switch (type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const items = prop.items as Record<string, unknown> | undefined;
      const itemSchema = items ? jsonSchemaPropertyToZod(items) : z.unknown();
      return z.array(itemSchema);
    }
    case 'object': {
      // Recurse into nested object properties
      const nestedProps = prop.properties as Record<string, Record<string, unknown>> | undefined;
      if (nestedProps && typeof nestedProps === 'object') {
        const nestedRequired = (prop.required as string[]) ?? [];
        const shape: Record<string, z.ZodType> = {};
        for (const [key, nested] of Object.entries(nestedProps)) {
          let fieldSchema = jsonSchemaPropertyToZod(nested);
          if (nested.description && typeof nested.description === 'string') {
            fieldSchema = fieldSchema.describe(nested.description);
          }
          if (!nestedRequired.includes(key)) {
            fieldSchema = fieldSchema.optional();
          }
          shape[key] = fieldSchema;
        }
        return z.object(shape).loose();
      }
      return z.object({}).loose();
    }
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
}

/**
 * Format MCP tool result content for LangChain consumption.
 */
function formatMcpResult(result: unknown): string {
  if (typeof result === 'string') return result;

  // MCP SDK returns { content: [{type, text}], isError? }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;

    if (Array.isArray(r.content)) {
      const texts = r.content
        .filter((item): item is {type: string; text: string} =>
          typeof item === 'object' && item !== null && 'text' in item,
        )
        .map((item) => item.text);

      if (texts.length > 0) {
        const prefix = r.isError ? '[MCP Error] ' : '';
        return prefix + texts.join('\n');
      }
    }
  }

  return JSON.stringify(result);
}
