/**
 * Headless/CI 模式 — 无交互执行。
 *
 * 通过 `-p "prompt"` 启动，执行完成后直接输出结果并退出。
 * 配合 `--json` 可输出结构化 JSON。
 */

import {AIMessage} from '@langchain/core/messages';
import type {Codara} from '@/index';
import type {OutputFormat} from '@cli/cli-args';

export interface HeadlessOptions {
  codara: Codara;
  prompt: string;
  outputFormat?: OutputFormat;
}

export interface HeadlessResult {
  /** 最终输出文本。 */
  text: string;
  /** 会话 ID。 */
  sessionId: string;
}

/**
 * 以 headless 模式执行一次 prompt，返回结果。
 */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  const {codara, prompt, outputFormat} = options;
  const result = await codara.invoke(prompt);

  // 提取最后一条 AI 消息的文本内容
  const messages = result.state.messages;
  let text = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg instanceof AIMessage && typeof msg.content === 'string' && msg.content.trim()) {
      text = msg.content;
      break;
    }
  }

  const sessionId = codara.getState().sessionId;
  const headlessResult: HeadlessResult = {text, sessionId};

  if (outputFormat === 'json') {
    process.stdout.write(JSON.stringify(headlessResult) + '\n');
  } else {
    process.stdout.write(text + '\n');
  }

  return headlessResult;
}
