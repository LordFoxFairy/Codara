import {useCallback, useState} from 'react';

export interface CliCommandOutputState {
  content: string;
  commandName?: string;
  scrollOffset: number;
}

export interface UseCommandOutputStateOutput {
  commandOutput?: CliCommandOutputState;
  clearCommandOutput: () => void;
  showCommandOutput: (content: string, commandName?: string) => void;
  scrollCommandOutput: (delta: number) => void;
}

export const COMMAND_OUTPUT_WINDOW_SIZE = 20;

export function createCliCommandOutput(content: string, commandName?: string): CliCommandOutputState {
  return {
    content,
    commandName,
    scrollOffset: 0,
  };
}

export function scrollCliCommandOutput(
  current: CliCommandOutputState | undefined,
  delta: number,
  windowSize: number = COMMAND_OUTPUT_WINDOW_SIZE,
): CliCommandOutputState | undefined {
  if (!current) {
    return current;
  }

  const totalLines = current.content.split('\n').length;
  const maxOffset = Math.max(0, totalLines - windowSize);
  const nextOffset = Math.max(0, Math.min(maxOffset, current.scrollOffset + delta));

  if (nextOffset === current.scrollOffset) {
    return current;
  }

  return {
    ...current,
    scrollOffset: nextOffset,
  };
}

// 这层只管命令输出面板自己的显示状态。
// controller 只需要告诉它“显示什么”和“往上/往下滚”。
export function useCommandOutputState(): UseCommandOutputStateOutput {
  const [commandOutput, setCommandOutput] = useState<CliCommandOutputState | undefined>();

  const clearCommandOutput = useCallback(() => {
    setCommandOutput(undefined);
  }, []);

  const showCommandOutput = useCallback((content: string, commandName?: string) => {
    setCommandOutput(createCliCommandOutput(content, commandName));
  }, []);

  const scrollCommandOutput = useCallback((delta: number) => {
    setCommandOutput((current) => scrollCliCommandOutput(current, delta));
  }, []);

  return {
    commandOutput,
    clearCommandOutput,
    showCommandOutput,
    scrollCommandOutput,
  };
}
