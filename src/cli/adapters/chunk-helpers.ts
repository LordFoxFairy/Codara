import type {AIMessageChunk} from '@langchain/core/messages';

export function normalizeUserInput(input: string): string {
  return input.trim();
}

export function isSlashCommandPrompt(prompt: string): boolean {
  return prompt.startsWith('/');
}

// stream 里会混进多种 chunk 形态，这里统一抽成文本，避免 UI 层处理协议细节。
export function renderChunkContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(item => {
      if (typeof item === 'string') {
        return item;
      }

      if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
        return item.text;
      }

      return '';
    })
    .join('');
}

export function extractMessageChunk(chunk: unknown): AIMessageChunk | undefined {
  if (!chunk || typeof chunk !== 'object') {
    return undefined;
  }

  if ('content' in chunk) {
    return chunk as AIMessageChunk;
  }

  if (Array.isArray(chunk) && chunk.length === 2 && chunk[0] === 'messages') {
    const payload = chunk[1];
    if (payload && typeof payload === 'object' && 'content' in payload) {
      return payload as AIMessageChunk;
    }
  }

  return undefined;
}
