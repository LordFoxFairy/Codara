import type {BaseMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext} from '@core/agents';

/** 摘要记录。 */
export interface SummaryRecord {
  content: string;
  updatedAt: string;
  summarizedMessages: number;
}

/** 传给 summarizer 的输入。 */
export interface SummaryInput {
  previousSummary?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  threadId?: string;
  turn: number;
}

/** 摘要函数。 */
export type SummaryGenerator = (input: SummaryInput) => Promise<string> | string;

/** SummaryMiddleware 配置。 */
export interface SummaryOptions {
  summarize: SummaryGenerator;
  maxMessages?: number;
  keepLastMessages?: number;
  maxChars?: number;
}
