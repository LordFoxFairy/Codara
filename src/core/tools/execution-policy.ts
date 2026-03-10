import type {StructuredToolInterface} from '@langchain/core/tools';

export type ToolExecutionPolicy = 'serial' | 'parallel_safe';

const TOOL_EXECUTION_POLICY = Symbol.for('codara.tool.execution.policy');

export function withToolExecutionPolicy<TTool extends StructuredToolInterface>(
  tool: TTool,
  policy: ToolExecutionPolicy,
): TTool {
  Object.defineProperty(tool, TOOL_EXECUTION_POLICY, {
    value: policy,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return tool;
}

export function readToolExecutionPolicy(tool: StructuredToolInterface | undefined): ToolExecutionPolicy {
  if (!tool) {
    return 'serial';
  }

  const value = (tool as unknown as Record<PropertyKey, unknown>)[TOOL_EXECUTION_POLICY];
  return value === 'parallel_safe' ? 'parallel_safe' : 'serial';
}
