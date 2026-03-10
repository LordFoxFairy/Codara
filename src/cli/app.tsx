import type {AIMessageChunk} from '@langchain/core/messages';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {createCodara} from '../index';

type CliStatus = 'idle' | 'running' | 'done' | 'error';
type CliRole = 'system' | 'user' | 'assistant' | 'error';

interface CliRunState {
  status: CliStatus;
  error?: string;
}

interface CliMessage {
  id: string;
  role: CliRole;
  content: string;
}

const initialPrompt = process.argv.slice(2).join(' ').trim();
const threadId = 'cli-dev';
const visibleMessageLimit = 12;

export function CodaraCliApp(): React.JSX.Element {
  const {exit} = useApp();
  const [codara] = useState(() => createCodara({threadId}));
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<CliMessage[]>([
    {
      id: createId('system'),
      role: 'system',
      content: 'Interactive Codara CLI. Type a prompt or slash command and press Enter. Press Ctrl+C or Esc to exit.',
    },
  ]);
  const [state, setState] = useState<CliRunState>({status: 'idle'});
  const runningRef = useRef(false);
  const initialPromptSentRef = useRef(false);

  const submitPrompt = useCallback(async (prompt: string): Promise<void> => {
    if (runningRef.current) {
      return;
    }

    runningRef.current = true;
    setState({status: 'running'});

    const userId = createId('user');
    const assistantId = createId(prompt.startsWith('/') ? 'system' : 'assistant');

    setMessages(current => [
      ...current,
      {id: userId, role: 'user', content: prompt},
      {id: assistantId, role: prompt.startsWith('/') ? 'system' : 'assistant', content: ''},
    ]);

    try {
      if (prompt.startsWith('/')) {
        const result = await codara.executeCommand(prompt);
        setMessages(current =>
          current.map(message =>
            message.id === assistantId
              ? {
                  ...message,
                  role: result.ok ? 'system' : 'error',
                  content: result.output || '(no output)',
                }
              : message
          )
        );
        setState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
        return;
      }

      let sawText = false;

      for await (const chunk of codara.stream(prompt, {streamMode: 'messages'})) {
        const text = renderChunkContent(extractMessageChunk(chunk)?.content);
        if (!text) {
          continue;
        }

        sawText = true;
        setMessages(current =>
          current.map(message =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content + text,
                }
              : message
          )
        );
      }

      if (!sawText) {
        setMessages(current =>
          current.map(message =>
            message.id === assistantId
              ? {
                  ...message,
                  content: '(no output)',
                }
              : message
          )
        );
      }

      setState({status: 'done'});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({status: 'error', error: message});
      setMessages(current => [
        ...current,
        {
          id: createId('error'),
          role: 'error',
          content: message,
        },
      ]);
    } finally {
      runningRef.current = false;
    }
  }, [codara]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      void codara.dispose().catch(() => undefined);
    };
  }, [codara]);

  useEffect(() => {
    if (!initialPrompt || initialPromptSentRef.current) {
      return;
    }

    initialPromptSentRef.current = true;
    void submitPrompt(initialPrompt);
  }, [submitPrompt]);

  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || key.escape) {
      exit();
      return;
    }

    if (runningRef.current) {
      return;
    }

    if (key.return || input === '\r' || input === '\n') {
      const prompt = draft.trim();
      if (!prompt) {
        return;
      }

      setDraft('');
      void submitPrompt(prompt);
      return;
    }

    if (key.backspace || key.delete) {
      setDraft(current => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setDraft(current => current + input);
    }
  });

  const visibleMessages = messages.slice(-visibleMessageLimit);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Text color="cyanBright">Codara CLI</Text>
        <Text dimColor>Interactive shell over `createCodara(...)` from the public runtime surface.</Text>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="blue" flexDirection="column" paddingX={1}>
        <Text color="blueBright">session</Text>
        <Text dimColor>thread: {threadId}</Text>
        <Text dimColor>cwd: {process.cwd()}</Text>
        <Text dimColor>status: {state.status}</Text>
        {state.error ? <Text color="red">error: {state.error}</Text> : null}
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="magenta" flexDirection="column" paddingX={1}>
        <Text color="magentaBright">conversation</Text>
        {visibleMessages.map(message => (
          <Box key={message.id} marginTop={1} flexDirection="column">
            <Text color={roleColorMap[message.role]}>{roleLabelMap[message.role]}</Text>
            <Text>{message.content || '(empty)'}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
        <Text color="yellowBright">input</Text>
        <Text dimColor>
          {runningRef.current
            ? 'Waiting for the current response stream to finish...'
            : 'Enter to send. Ctrl+C or Esc to exit.'}
        </Text>
        <Box marginTop={1}>
          <Text color="greenBright">{'>'} </Text>
          <Text>{draft}</Text>
          <Text color="greenBright">|</Text>
        </Box>
      </Box>
    </Box>
  );

}

const roleLabelMap: Record<CliRole, string> = {
  system: 'system',
  user: 'you',
  assistant: 'codara',
  error: 'error',
};

const roleColorMap: Record<CliRole, React.ComponentProps<typeof Text>['color']> = {
  system: 'cyan',
  user: 'green',
  assistant: 'magenta',
  error: 'red',
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderChunkContent(content: unknown): string {
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

function extractMessageChunk(chunk: unknown): AIMessageChunk | undefined {
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
