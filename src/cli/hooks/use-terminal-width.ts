import {useEffect, useState} from 'react';
import {useStdout} from 'ink';

const DEFAULT_TERMINAL_WIDTH = 80;

function readTerminalWidth(columns: number | undefined): number {
  if (!columns || Number.isNaN(columns)) {
    return DEFAULT_TERMINAL_WIDTH;
  }

  return Math.max(24, columns);
}

// 终端缩放需要显式触发 re-render；这个 hook 只给字符宽度相关内容使用。
export function useTerminalWidth(): number {
  const {stdout} = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(() => readTerminalWidth(stdout.columns));

  useEffect(() => {
    const updateWidth = () => {
      setTerminalWidth(readTerminalWidth(stdout.columns));
    };

    updateWidth();
    stdout.on('resize', updateWidth);

    return () => {
      stdout.off('resize', updateWidth);
    };
  }, [stdout]);

  return terminalWidth;
}
