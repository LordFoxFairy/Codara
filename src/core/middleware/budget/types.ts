export interface ContextBudgetSnapshot {
  maxInputTokens: number;
  reservedTokens: number;
  availableInputTokens: number;
  estimatedInputTokens: number;
  overBudget: boolean;
}
