const TASK_CLOSEOUT_WAITING_PATTERNS = [
  /等待(?:子代理|subagent|委派任务|后台任务).*(?:返回|结果|完成|结束)/i,
  /等待(?:结果|返回).*(?:子代理|subagent|委派任务|后台任务)/i,
  /waiting for (?:the )?(?:subagent|delegated task|delegated tasks|task result|task results)/i,
  /wait for (?:runtime updates|the delegated result|review requests)/i,
];

const TASK_CLOSEOUT_STAGING_PATTERNS = [
  /第[一1]阶段.*(?:已启动|启动了|已开始|正在进行)/i,
  /phase\s*1.*(?:has started|started|is underway)/i,
  /已启动\s*\d+\s*个.*(?:子代理|subagent)/i,
  /将继续执行第[二2]阶段/i,
  /(?:下一阶段|第二阶段).*(?:继续|执行|开展)/i,
  /(?:continue|continuing).*(?:phase\s*2|the second phase|next phase)/i,
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

  return [...TASK_CLOSEOUT_WAITING_PATTERNS, ...TASK_CLOSEOUT_STAGING_PATTERNS]
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
