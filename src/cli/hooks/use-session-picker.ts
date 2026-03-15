import {useCallback, useEffect, useState} from 'react';
import type {SessionState} from '@/index';

export interface SessionPickerItem {
  sessionId: string;
  title: string;
  messageCount: number;
  timeAgo: string;
  truncatedId: string;
}

export interface SessionPickerState {
  visible: boolean;
  sessions: SessionPickerItem[];
  loading: boolean;
  selectedIndex: number;
}

export interface UseSessionPickerInput {
  listSessions: () => Promise<SessionState[]>;
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export interface UseSessionPickerOutput {
  state: SessionPickerState;
  show: () => void;
  hide: () => void;
  moveUp: () => void;
  moveDown: () => void;
  select: () => void;
}

const MAX_SESSIONS = 10;

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatTimeAgo(timestamp: string, now: number): string {
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

function derivePickerItems(sessions: SessionState[]): SessionPickerItem[] {
  const now = Date.now();
  return sessions.slice(0, MAX_SESSIONS).map((s) => ({
    sessionId: s.sessionId,
    title: s.metadata?.title || 'Untitled',
    messageCount: s.metadata?.messageCount ?? 0,
    timeAgo: formatTimeAgo(s.metadata?.lastActivity ?? s.updatedAt, now),
    truncatedId: truncateId(s.sessionId),
  }));
}

export function useSessionPicker(input: UseSessionPickerInput): UseSessionPickerOutput {
  const {listSessions, onSelect, onCancel} = input;
  const [visible, setVisible] = useState(false);
  const [sessions, setSessions] = useState<SessionPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const show = useCallback(() => {
    setVisible(true);
    setSelectedIndex(0);
    setLoading(true);
    setSessions([]);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    setSessions([]);
    setSelectedIndex(0);
    onCancel();
  }, [onCancel]);

  // Load sessions when picker becomes visible
  useEffect(() => {
    if (!visible || !loading) return;

    let cancelled = false;
    void listSessions().then(
      (result) => {
        if (!cancelled) {
          setSessions(derivePickerItems(result));
          setLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setSessions([]);
          setLoading(false);
        }
      },
    );

    return () => { cancelled = true; };
  }, [visible, loading, listSessions]);

  const moveUp = useCallback(() => {
    setSelectedIndex((current) => (current > 0 ? current - 1 : sessions.length - 1));
  }, [sessions.length]);

  const moveDown = useCallback(() => {
    setSelectedIndex((current) => (current < sessions.length - 1 ? current + 1 : 0));
  }, [sessions.length]);

  const select = useCallback(() => {
    if (sessions.length === 0) return;
    const safeIndex = Math.min(selectedIndex, sessions.length - 1);
    const session = sessions[safeIndex];
    if (session) {
      setVisible(false);
      onSelect(session.sessionId);
    }
  }, [sessions, selectedIndex, onSelect]);

  return {
    state: {
      visible,
      sessions,
      loading,
      selectedIndex: Math.min(selectedIndex, Math.max(0, sessions.length - 1)),
    },
    show,
    hide,
    moveUp,
    moveDown,
    select,
  };
}
