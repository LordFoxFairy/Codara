// ── Instructions ─────────────────────────────────────────────────────
export {
  createCodaraGuidelinesSource,
  type GuidelinesSource,
} from '@context/guidelines';
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

// ── Prompts ──────────────────────────────────────────────────────────
export {
  createCodaraPromptSource,
  type PromptSource,
} from '@context/prompts';

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
} from '@context/system-message';
export {
  createSkillsRuntimeBundle,
  loadSkillsRuntimeBundle,
  type SkillsRuntimeBundle,
} from '@context/skills-bundle';
