/**
 * Default AgentFactory and SessionMiddlewareFactory implementations.
 *
 * These live in the codara layer because they depend on @core/agent and @core/middleware.
 * The durability/session layer depends only on the factory interfaces defined in session/types.ts.
 */

import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {BaseMessage} from '@langchain/core/messages';
import type {Agent, AgentInput} from '@shared/agent-types';
import {bootstrapAgent} from '@core/agent/bootstrap';
import {normalizeAgentInput} from '@core/agent/run/agent-loop';
import {
  compactConversationWithSummary,
  createModelSummaryGenerator,
  createSummaryMiddleware,
  resolveSummaryOptions,
  type SummaryOptions,
  type SummarySettings,
} from '@core/middleware/summary';
import {MIDDLEWARE_NAMES, type BaseMiddleware} from '@core/pipeline-types';
import type {AgentFactory, AgentFactoryCreateOptions, SessionMiddlewareFactory} from '@durability/session/types';

// ── AgentFactory ──

export function createDefaultAgentFactory(): AgentFactory {
  return {
    async create(options: AgentFactoryCreateOptions): Promise<Agent> {
      return bootstrapAgent({
        ...options,
        middleware: options.middleware as BaseMiddleware[] | undefined,
      });
    },
    normalizeInput(input: AgentInput): BaseMessage[] {
      return normalizeAgentInput(input);
    },
  };
}

// ── SessionMiddlewareFactory ──

export function createDefaultMiddlewareFactory(): SessionMiddlewareFactory {
  return {
    middlewareNames: {
      Summary: MIDDLEWARE_NAMES.Summary,
      Review: MIDDLEWARE_NAMES.Review,
    },
    createSummaryMiddleware(settings: unknown): unknown | undefined {
      return createSummaryMiddleware({summary: settings as false | SummarySettings});
    },
    resolveSummaryOptions(settings: unknown, model: BaseChatModel): unknown | undefined {
      if (!settings) return undefined;
      return resolveSummaryOptions(
        settings as SummarySettings,
        createModelSummaryGenerator(model),
      );
    },
    async compactConversation(input: unknown, summary: unknown) {
      return compactConversationWithSummary(
        input as Parameters<typeof compactConversationWithSummary>[0],
        summary as Required<SummaryOptions>,
      );
    },
  };
}
