const TASK_CLOSEOUT_WAITING_PATTERNS = [
  /waiting for (?:the )?(?:subagent|delegated task|delegated tasks|task result|task results)/i,
  /wait for (?:runtime updates|the delegated result|review requests)/i,
  /当前.*等待.*(?:结果|返回|完成)/,
  /正在等待.*(?:子代理|委派任务|后台任务|结果|返回)/,
  /等待.*(?:子代理|委派任务|后台任务).*(?:结果|返回|完成)/,
];

const TASK_CLOSEOUT_FUTURE_WORK_PATTERNS = [
  /\bphase\s*\d+\b.*(?:has started|started|is underway|is running)/i,
  /\b(?:after|once|when)\b[\s\S]{0,120}\b(?:complete|completed|finish(?:ed)?|return(?:ed|s)?)\b[\s\S]{0,120}\b(?:i|we)\b[\s\S]{0,40}\b(?:will|shall|then|can)\b/i,
  /\b(?:i|we)\b[\s\S]{0,40}\b(?:will|shall)\b[\s\S]{0,120}\b(?:after|once|when)\b[\s\S]{0,120}\b(?:complete|completed|finish(?:ed)?|return(?:ed|s)?)\b/i,
  /\b(?:next phase|second phase|later phase|next step|follow-up step|remaining work)\b[\s\S]{0,60}\b(?:will|shall|then|needs to|to be)\b/i,
  /\b(?:only when|until)\b[\s\S]{0,120}\b(?:all|everything|all tasks|all subagents)\b[\s\S]{0,120}\b(?:complete|completed|done)\b[\s\S]{0,80}\b(?:will|shall|then)\b/i,
  /已启动第[一二三四五六七八九十\d]+阶段/,
  /当前.*(?:处于|还在).*(?:阶段|等待|进行中)/,
  /完成后.*(?:将|会|再).*(?:进入|启动|继续|执行|输出|总结|汇总|回答)/,
  /(?:下一阶段|第二阶段|后续步骤|后续工作).*(?:将|会|继续|启动|进入|执行)/,
  /(?:全部|所有).*(?:完成|结束).*后.*(?:再|才).*(?:输出|总结|汇总|回答)/,
];

function normalizeTaskCloseoutText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

export function isInvalidTaskCloseoutResponse(text: string | undefined): boolean {
  const normalized = normalizeTaskCloseoutText(text ?? '');
  if (!normalized) {
    return false;
  }

  return [...TASK_CLOSEOUT_WAITING_PATTERNS, ...TASK_CLOSEOUT_FUTURE_WORK_PATTERNS]
    .some((pattern) => pattern.test(normalized));
}

export function shouldRetryTaskCloseoutResponse(input: {
  text: string | undefined;
  launchedTaskToolCall?: boolean;
  attempt: number;
  maxAttempts: number;
}): boolean {
  if (input.launchedTaskToolCall) {
    return false;
  }

  if (input.attempt >= input.maxAttempts) {
    return false;
  }

  return isInvalidTaskCloseoutResponse(input.text);
}
