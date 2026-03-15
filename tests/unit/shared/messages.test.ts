import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage} from '@langchain/core/messages';
import {readLatestVisibleMessageText, readVisibleMessageText} from '@shared/messages';

describe('shared message helpers', () => {
  it('should hide HIL pause payloads from visible message text', () => {
    const message = new ToolMessage({
      content: JSON.stringify({
        type: 'hil_pause',
        request: {id: 'pause-1'},
      }),
      tool_call_id: 'call_1',
    });

    expect(readVisibleMessageText(message)).toBeUndefined();
  });

  it('should fall back to the latest visible message when the last message is a hidden HIL payload', () => {
    const messages = [
      new HumanMessage('hello'),
      new AIMessage('Need your input before I continue.'),
      new ToolMessage({
        content: JSON.stringify({
          type: 'hil_pause',
          request: {id: 'pause-1'},
        }),
        tool_call_id: 'call_1',
      }),
    ];

    expect(readLatestVisibleMessageText(messages)).toBe('Need your input before I continue.');
  });
});
