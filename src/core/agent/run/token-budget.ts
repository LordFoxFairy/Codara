export interface TokenBudgetState {
  contextWindow: number;        // max tokens for the model
  reservedOutput: number;       // tokens reserved for output (default 4096)
  estimatedUsed: number;        // estimated tokens in current messages
  continuationCount: number;    // how many times we've continued
  lastDeltaTokens: number;      // tokens added in last turn
}

export function createTokenBudgetState(contextWindow: number): TokenBudgetState {
  return {
    contextWindow,
    reservedOutput: Math.min(4096, Math.floor(contextWindow * 0.1)),
    estimatedUsed: 0,
    continuationCount: 0,
    lastDeltaTokens: 0,
  };
}

export function shouldAutoCompact(budget: TokenBudgetState): boolean {
  const available = budget.contextWindow - budget.reservedOutput;
  const ratio = budget.estimatedUsed / available;
  // Auto-compact when >= 85% of available budget used
  return ratio >= 0.85;
}

export function shouldStopContinuation(budget: TokenBudgetState): boolean {
  const available = budget.contextWindow - budget.reservedOutput;
  // Stop at 95% usage
  if (budget.estimatedUsed / available >= 0.95) return true;
  // Diminishing returns: 3+ continuations with <500 new tokens each
  if (budget.continuationCount >= 3 && budget.lastDeltaTokens < 500) return true;
  return false;
}

// Simple token estimator (4 chars ≈ 1 token)
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokenCount(messages: Array<{content?: unknown}>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokenCount(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') total += estimateTokenCount(part);
        else if (typeof part?.text === 'string') total += estimateTokenCount(part.text);
      }
    }
    total += 4; // message overhead
  }
  return total;
}
