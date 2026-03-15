import {useEffect, useState} from 'react';

export const TIPS = [
  'Type / to see available commands',
  'Use Shift+Enter for multi-line input',
  'Press Ctrl+C to interrupt',
  'Start with a question or paste code',
  'Use /resume to continue a previous session',
  'Try "how does <filepath> work?"',
];

const TIP_INTERVAL_MS = 8000;

export function useRotatingTip(): string {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length));

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(current => (current + 1) % TIPS.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return TIPS[index]!;
}
