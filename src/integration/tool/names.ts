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
