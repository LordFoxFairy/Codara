// ── Instructions ─────────────────────────────────────────────────────
export {
  createCodaraGuidelinesSource,
  type GuidelinesSource,
} from '@context/instructions/guidelines';
export {
  SessionScopedProgressiveInstructionSource,
  type ProgressiveInstructionSource,
  type ProgressiveInstructionSourceOptions,
  type ProgressiveInstructionWorkspaceOptions,
} from '@context/instructions/progressive-source';
export {
  loadConditionalRules,
  matchRulesForPath,
  type ConditionalRule,
} from '@context/instructions/rules';

// ── Memory ───────────────────────────────────────────────────────────
export {
  createAutoMemoryRuntime,
  resolveAutoMemoryRoot,
  shouldRecordAutoMemoryTurn,
  type AutoMemoryRuntime,
  type AutoMemoryRuntimeOptions,
  type AutoMemorySource,
  type AutoMemoryTurnInput,
  type MemoryType,
} from '@context/memory/auto-memory';
export {
  evictMemoryFiles,
  DEFAULT_EVICTION_POLICY,
  type EvictionPolicy,
} from '@context/memory/eviction';

// ── Prompts ──────────────────────────────────────────────────────────
export {
  createCodaraPromptSource,
  type PromptSource,
} from '@context/prompts/prompt-source';

// ── Session Bundle ───────────────────────────────────────────────────
export {
  buildBaseSystemMessage,
  readBaseSystemMessage,
  applyPreparedInstructionContext,
  mergePreparedInstructionContext,
  type BaseSystemMessageBundle,
  type BaseSystemMessageRuntimeData,
  type BuildBaseSystemMessageOptions,
  type PreparedInstructionContextTarget,
} from '@context/session-bundle/base-system-message';
export {
  createSkillsRuntimeBundle,
  loadSkillsRuntimeBundle,
  type SkillsRuntimeBundle,
} from '@context/skills/build';
