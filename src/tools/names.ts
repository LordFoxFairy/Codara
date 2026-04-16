/**
 * Tool name resolution — 过滤工具列表和别名解析。
 *
 * normalizeToolReferenceName 将用户输入别名映射为内部工具名
 * （如 "read" → "read_file"），供权限规则和工具引用使用。
 */

import type {StructuredToolInterface} from '@langchain/core/tools';
import {normalizeToolReferenceName} from '@shared/tool-names';

export {normalizeToolReferenceName} from '@shared/tool-names';

export function filterToolsByReferences(
  tools: StructuredToolInterface[],
  references: string[]
): StructuredToolInterface[] {
  if (references.length === 0) {
    return [...tools];
  }

  const allowed = new Set(references
    .map((reference) => normalizeToolReferenceName(reference))
    .filter(Boolean));

  return tools.filter((tool) => allowed.has(normalizeToolReferenceName(tool.name)));
}
