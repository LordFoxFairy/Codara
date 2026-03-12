import type {CliSessionMeta} from '../state/shell-types';

// 这些元信息先保持集中管理，后续再接真实 runtime/session metadata。
export const DEFAULT_SESSION_META: CliSessionMeta = {
  title: 'Codara Code',
  subtitle: 'General-purpose coding agent shell',
  model: 'Claude Sonnet 4.5',
  route: 'default',
  mode: 'workspace-write',
  session: 'local prototype',
};

export const SHORTCUTS_HINT = '? for shortcuts';
export const THINKING_HINT = 'Thinking off (tab to toggle)';
export const AUTO_UPDATE_HINT = 'Auto-updating...';
