import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, RuntimeStatus } from "../types";

const API_BASE = "http://localhost:23981";
const POLL_INTERVAL = 5000;
const RETRY_INTERVAL = 1000; // faster retries when disconnected
const MAX_FAST_RETRIES = 15; // try for 15 seconds on startup

export function useStatus() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({
    connected: false,
  });
  const fastRetriesLeft = useRef(MAX_FAST_RETRIES);

  const check = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${API_BASE}/api/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error("Status check failed");
      const data = (await res.json()) as Record<string, unknown>;
      setRuntimeStatus({ ...data, connected: true } as RuntimeStatus);
      setConnectionStatus("connected");
      fastRetriesLeft.current = 0; // stop fast retries once connected
    } catch {
      setConnectionStatus((prev) => {
        // Don't flash "disconnected" on first load — keep initial state
        // until we've exhausted fast retries
        if (fastRetriesLeft.current > 0) return prev;
        return "disconnected";
      });
      setRuntimeStatus({ connected: false });
    }
  }, []);

  useEffect(() => {
    // Immediately check
    void check();

    // Fast retry loop for startup
    const fastTimer = setInterval(() => {
      if (fastRetriesLeft.current > 0) {
        fastRetriesLeft.current--;
        void check();
      }
    }, RETRY_INTERVAL);

    // Normal polling
    const normalTimer = setInterval(() => void check(), POLL_INTERVAL);

    return () => {
      clearInterval(fastTimer);
      clearInterval(normalTimer);
    };
  }, [check]);

  return { connectionStatus, runtimeStatus, check };
}
