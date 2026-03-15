/**
 * 终端宽度 Hook — debounce resize 事件，稳定后清屏触发一次干净重绘。
 *
 * 为什么需要 debounce + 清屏：
 * Ink 使用差分渲染（对比上一帧计算需要更新的行），终端宽度突变时
 * 旧帧按旧宽度排列的字符无法被正确覆盖，导致残留乱象。
 * debounce 150ms 后统一清屏 + 更新 state，Ink 在干净画布上重绘一帧。
 */

import {useEffect, useRef, useState} from 'react';
import {useStdout} from 'ink';

const DEFAULT_TERMINAL_WIDTH = 80;

/** resize 稳定判定间隔（ms） */
const RESIZE_DEBOUNCE_MS = 150;

function readTerminalWidth(columns: number | undefined): number {
  if (!columns || Number.isNaN(columns)) {
    const envCols = Number(process.env.COLUMNS);
    return envCols > 0 ? Math.max(24, envCols) : DEFAULT_TERMINAL_WIDTH;
  }

  return Math.max(24, columns);
}

export function useTerminalWidth(): number {
  const {stdout} = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(() => readTerminalWidth(stdout.columns));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = () => {
      // 清除上一次定时器，实现 debounce
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // 清屏：清除可见区域 + scrollback 缓冲区，让下一帧在干净画布上绘制
        if (stdout.isTTY) {
          process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        }
        // 更新 state 触发 React 重渲染
        setTerminalWidth(readTerminalWidth(stdout.columns));
      }, RESIZE_DEBOUNCE_MS);
    };

    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [stdout]);

  return terminalWidth;
}
