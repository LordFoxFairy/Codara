import type {AIMessageChunk, BaseMessage} from '@langchain/core/messages';
import {createCodaraRuntime} from '@codara/facade';
import type {GatewaySession, GatewaySessionFactory} from './session-manager';

export interface CodaraSessionFactoryOptions {
  model?: string;
  cwd?: string;
}

/**
 * Factory that creates real Codara agent sessions for the Gateway.
 * Each session key gets an isolated Codara runtime with full agent capabilities.
 */
export function createCodaraSessionFactory(options?: CodaraSessionFactoryOptions): GatewaySessionFactory {
  return async (sessionKey: string, _profile?: string): Promise<GatewaySession> => {
    const runtime = await createCodaraRuntime({
      sessionId: sessionKey,
      ...(options?.model ? {alias: options.model} : {}),
      ...(options?.cwd ? {cwd: options.cwd} : {}),
    });

    return {
      async invoke(text: string): Promise<string> {
        const result = await runtime.invoke(text);
        const messages = result?.state?.messages ?? [];
        const lastAI = [...messages].reverse().find(
          (m: BaseMessage) => m.type === 'ai',
        );
        return typeof lastAI?.content === 'string'
          ? lastAI.content
          : JSON.stringify(lastAI?.content ?? result.reason);
      },

      async *stream(text: string): AsyncGenerator<string, string, void> {
        const gen = runtime.stream(text);
        let fullText = '';
        for await (const chunk of gen) {
          // AIMessageChunk carries streamed text content
          if (chunk && typeof chunk === 'object' && 'content' in chunk) {
            const content = (chunk as AIMessageChunk).content;
            if (typeof content === 'string' && content) {
              fullText += content;
              yield content;
            }
          }
        }
        return fullText;
      },

      async dispose(): Promise<void> {
        await runtime.dispose();
      },
    };
  };
}
