/**
 * Shared formatting utilities for the CLI layer.
 *
 * Consolidates duplicated helpers that were scattered across header.tsx,
 * session-picker.tsx, activity-line.tsx, welcome-state.tsx, and model.ts.
 */

/** Format a token count for display: 22800 → "22.8k", 1500000 → "1.5M" */
export function formatTokenCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Format a timestamp as relative time: "just now", "5m ago", "2h ago", "3d ago", "1w ago" */
export function formatTimeAgo(timestamp: string, now = Date.now()): string {
  const diff = now - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** Format elapsed milliseconds for display: "5s", "1m30s" */
export function formatElapsedMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining.toString().padStart(2, '0')}s`;
}
