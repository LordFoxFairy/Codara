import {useEffect, useState} from 'react';

const CURSOR_BLINK_INTERVAL_MS = 530;
const CURSOR_BLINK_IDLE_DELAY_MS = 650;

// Prompt 是自绘的，所以光标也必须由我们自己渲染和闪烁。
export function useBlinkingCursor(enabled: boolean, activityVersion = 0): boolean {
  const [visible, setVisible] = useState(true);
  const [blinkingVersion, setBlinkingVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const intervalStart = setTimeout(() => {
      setVisible(true);
      setBlinkingVersion(activityVersion);
      timer = setInterval(() => {
        setVisible(current => !current);
      }, CURSOR_BLINK_INTERVAL_MS);
    }, CURSOR_BLINK_IDLE_DELAY_MS);

    return () => {
      clearTimeout(intervalStart);
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [activityVersion, enabled]);

  if (!enabled) {
    return false;
  }

  return blinkingVersion === activityVersion ? visible : true;
}
