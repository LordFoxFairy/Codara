/**
 * Context module barrel — re-exports everything consumers need from src/context/.
 *
 * File layout (8 files, post-merge):
 *   instructions.ts   — Progressive instruction engine (load/cache/render hierarchical files)
 *   sources.ts         — Concrete instruction sources (AGENTS.md, codara.md)
 *   rules.ts           — Glob-conditional rules from .codara/rules/
 *   dynamic-sections.ts — Runtime registry for lazy context providers
 *   git-context.ts     — Git status/branch provider
 *   memory-context.ts  — ~/.codara/memory/ provider
 *   skills-bundle.ts   — Skill metadata -> system prompt fragment
 *   system-message.ts  — Central orchestrator: assembles all sources into final system message
 */

// ── Instruction Sources ──────────────────────────────────────────────
export {
  createCodaraGuidelinesSource,
  type GuidelinesSource,
  createCodaraPromptSource,
  type PromptSource,
} from '@context/sources';
export {
  SessionScopedProgressiveInstructionSource,
  type ProgressiveInstructionSource,
  type ProgressiveInstructionSourceOptions,
  type ProgressiveInstructionWorkspaceOptions,
} from '@context/instructions';
export {
  loadConditionalRules,
  matchRulesForPath,
  type ConditionalRule,
} from '@context/rules';

// ── Dynamic Context ─────────────────────────────────────────────────
export {DynamicSectionRegistry, type DynamicSectionProvider} from '@context/dynamic-sections';
export {fetchGitContext, formatGitContextSection, createGitContextProvider, clearGitContextCache, type GitContext} from '@context/git-context';
export {loadMemoryContext, formatMemoryContextSection, createMemoryContextProvider, type MemoryContext, type MemoryEntry} from '@context/memory-context';

// ── System Message Assembly ─────────────────────────────────────────
export {
  buildBaseSystemMessage,
  readBaseSystemMessage,
  applyPreparedInstructionContext,
  mergePreparedInstructionContext,
  type BaseSystemMessageBundle,
  type BaseSystemMessageRuntimeData,
  type BuildBaseSystemMessageOptions,
  type PreparedInstructionContextTarget,
} from '@context/system-message';
export {
  createSkillsRuntimeBundle,
  loadSkillsRuntimeBundle,
  type SkillsRuntimeBundle,
} from '@context/skills-bundle';
