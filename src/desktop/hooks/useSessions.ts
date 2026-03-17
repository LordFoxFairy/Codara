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
      const data = (await res.json()) as Session[];
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
      const session = (await res.json()) as Session;
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

  return { sessions, loading, error, refresh, createSession };
}
