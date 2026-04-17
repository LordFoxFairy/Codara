/**
 * Validation + instruction patterns used by subagent completion logic.
 *
 * Extracted so the main `completion.ts` file can focus on middleware
 * wiring and formatting, while the regex catalogue + static instruction
 * prose live in a dedicated file for easier scanning.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Validation pattern registry — declarative, easy to add/remove patterns
// ---------------------------------------------------------------------------

export interface ValidationPattern {
  /** Human-readable label (used for debugging, not at runtime). */
  label: string;
  pattern: RegExp;
}

/**
 * Patterns that detect "still waiting for subagent results" language.
 * When matched, the model's response is considered invalid.
 */
export const WAITING_PATTERNS: ValidationPattern[] = [
  {label: 'en:waiting-for-subagent', pattern: /waiting for (?:the )?(?:subagent|subagent run|subagent runs|subagent result|subagent results)/i},
  {label: 'en:wait-for-runtime', pattern: /wait for (?:runtime updates|the subagent result|review requests)/i},
  {label: 'zh:current-waiting', pattern: /当前.*等待.*(?:结果|返回|完成)/},
  {label: 'zh:waiting-for', pattern: /正在等待.*(?:子代理|后台任务|结果|返回)/},
  {label: 'zh:wait-result', pattern: /等待.*(?:子代理|后台任务).*(?:结果|返回|完成)/},
];

/**
 * Patterns that detect "future work / staged plan" language.
 * When matched, the model's response is considered invalid.
 */
export const FUTURE_WORK_PATTERNS: ValidationPattern[] = [
  {label: 'en:phase-started', pattern: /\bphase\s*\d+\b.*(?:has started|started|is underway|is running)/i},
  {label: 'en:after-complete-will', pattern: /\b(?:after|once|when)\b[\s\S]{0,120}\b(?:complete|completed|finish(?:ed)?|return(?:ed|s)?)\b[\s\S]{0,120}\b(?:i|we)\b[\s\S]{0,40}\b(?:will|shall|then|can)\b/i},
  {label: 'en:will-after-complete', pattern: /\b(?:i|we)\b[\s\S]{0,40}\b(?:will|shall)\b[\s\S]{0,120}\b(?:after|once|when)\b[\s\S]{0,120}\b(?:complete|completed|finish(?:ed)?|return(?:ed|s)?)\b/i},
  {label: 'en:next-phase-will', pattern: /\b(?:next phase|second phase|later phase|next step|follow-up step|remaining work)\b[\s\S]{0,60}\b(?:will|shall|then|needs to|to be)\b/i},
  {label: 'en:until-all-done', pattern: /\b(?:only when|until)\b[\s\S]{0,120}\b(?:all|everything|all tasks|all subagents)\b[\s\S]{0,120}\b(?:complete|completed|done)\b[\s\S]{0,80}\b(?:will|shall|then)\b/i},
  {label: 'zh:phase-n-started', pattern: /已启动第[一二三四五六七八九十\d]+阶段/},
  {label: 'zh:current-phase', pattern: /当前.*(?:处于|还在).*(?:阶段|等待|进行中)/},
  {label: 'zh:after-complete-will', pattern: /(?:完成后|全部.*完成后).*?(?:我|我们).*?(?:将|会|再).*?(?:进入|启动|继续|执行|输出|总结|汇总|回答)/},
  {label: 'zh:next-phase-will', pattern: /(?:下一阶段|第二阶段|后续步骤|后续工作).*?(?:我|我们).*?(?:将|会|继续|启动|进入|执行)/},
  {label: 'zh:all-done-then', pattern: /(?:全部|所有).*(?:完成|结束).*后.*(?:再|才).*(?:输出|总结|汇总|回答)/},
  {label: 'zh:both-completed-summarize', pattern: /(?:两个|两条|all|both).*(?:subagent|子代理).*(?:已完成|都已完成|completed).*(?:现在|接下来|让我|let me|now).*(?:汇总|总结|summari[sz]e|synthesi[sz]e)/i},
  {label: 'mixed:completed-now-summarize', pattern: /(?:subagent|子代理).*(?:完成|completed).*(?:现在|接下来|让我|let me|now).*(?:汇总|总结|summari[sz]e|synthesi[sz]e)/i},
];

/** All invalid-response patterns merged for single-pass matching. */
export const ALL_INVALID_PATTERNS: readonly ValidationPattern[] = [
  ...WAITING_PATTERNS,
  ...FUTURE_WORK_PATTERNS,
];

// ---------------------------------------------------------------------------
// System-message handoff instructions (static prose)
// ---------------------------------------------------------------------------

export const COMPLETION_HANDOFF_INSTRUCTIONS: readonly string[] = [
  'Completed subagent runs from your previous response are now available.',
  'Continue the parent task using these completed subagent results.',
  'If more work is still needed, immediately take the next step, including launching more subagent runs if appropriate.',
  'Only give a final user-facing answer once the entire original user request is satisfied.',
  'A completed subagent batch does not by itself mean the overall request is complete.',
  'If the user explicitly required later phases, serial follow-up steps, or additional analysis after this batch, do that next before answering.',
  'A progress-only update is not a valid completion.',
  'If your draft says work will continue later, that another phase will start later, or that you will answer after more results arrive, that draft is invalid.',
  'Either launch the required next-step work now or give the final answer only if no requested work remains.',
  'If the work is complete, respond with a unified user-facing answer.',
  'Do not claim the subagent work is still pending or that you are waiting for results that are already complete.',
  'Treat the completed subagent results below as finished work products, not as tasks to be restarted.',
  'Do not restart the plan from the beginning, do not relaunch the initial batch, and do not repeat a completed phase.',
  'Do not launch another subagent run that repeats, paraphrases, or only lightly rewords a completed topic listed below.',
  'If you launch more subagent runs, launch only the missing next-step work that builds on the completed results.',
  'Do not mention subagents, hidden handoff context, or orchestration stages in the user-visible answer.',
  'Do not structure the reply as per-task, per-subagent, or per-phase sections.',
  'Never write headings such as "Subagent report", "Phase 1", "First subagent", or similar orchestration labels.',
  'Do not restate task-by-task reports or raw child sections.',
  'Do not quote raw subagent output verbatim and do not mention hidden handoff context.',
  'The execution tree already showed the subagent work; your job is to synthesize the result for the user, not to replay child output.',
  'Use the completed subagent results below only as internal synthesis context:',
];

export const RETRY_CORRECTION_LINES: readonly string[] = [
  'Your previous continuation was invalid because it still described the subagent work as waiting or staged.',
  'All completed subagent runs are already terminal. Do not say they are still pending, waiting, just started, or that another phase will continue later.',
];

export const REPEATED_CORRECTION_LINES: readonly string[] = [
  'This is a repeated correction attempt.',
  'Do not provide another orchestration-status update, waiting update, or future-work promise.',
  'If you do not need to launch a new Agent tool call right now, respond with the actual final answer for the user in this turn.',
];
