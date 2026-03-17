import { useCallback, useEffect, useState } from "react";
import type { Session } from "../types";

const API_BASE = "http://localhost:23981";

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
      const json = await res.json();
      const raw = (Array.isArray(json) ? json : json.sessions ?? []) as Record<string, unknown>[];
      const data: Session[] = raw
        .map((s) => {
          const meta = (s.metadata ?? {}) as Record<string, unknown>;
          return {
            id: (s.sessionId ?? s.id ?? "") as string,
            title: (meta.title ?? s.title ?? "New Chat") as string,
            createdAt: (s.createdAt ?? new Date().toISOString()) as string,
            updatedAt: (s.updatedAt ?? s.createdAt ?? new Date().toISOString()) as string,
            messageCount: (meta.messageCount ?? 0) as number,
          };
        })
        // Only show sessions that have actual messages
        .filter((s) => s.messageCount > 0);
      setSessions(data);
      setError(null);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createSession = useCallback(async (): Promise<Session | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
      const json = await res.json();
      // Server returns {sessionId: string}, construct a minimal Session object
      const session: Session = {
        id: json.sessionId ?? json.id,
        title: json.title ?? "New Chat",
        createdAt: json.createdAt ?? new Date().toISOString(),
        updatedAt: json.updatedAt ?? new Date().toISOString(),
        messageCount: 0,
      };
      setSessions((prev) => [session, ...prev]);
      setError(null);
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.messages ?? []) as Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        thinking?: string;
        timestamp: number;
      }>;
    } catch {
      return [];
    }
  }, []);

  return { sessions, loading, error, refresh, createSession, loadMessages };
}
