/**
 * Plan Mode — 工具过滤与模式判定。
 *
 * Plan 模式下，写操作工具（write_file / edit_file）被禁用，
 * 只保留只读 / 探索类工具，确保 AI 在规划阶段不会误操作文件。
 */

import type {StructuredToolInterface} from '@langchain/core/tools';

/** Codara 运行模式。 */
export type CodaraMode = 'normal' | 'plan' | 'auto';

/** Plan 模式下禁用的工具名集合。 */
export const PLAN_MODE_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
]);

/** 过滤掉 Plan 模式下禁用的工具。 */
export function filterToolsForPlanMode(tools: StructuredToolInterface[]): StructuredToolInterface[] {
  return tools.filter((t) => !PLAN_MODE_BLOCKED_TOOLS.has(t.name));
}

/** 判断当前模式是否允许写操作。 */
export function isModeWriteAllowed(mode: CodaraMode): boolean {
  return mode !== 'plan';
}
