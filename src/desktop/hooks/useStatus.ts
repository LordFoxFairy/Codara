/**
 * @module desktop/hooks/useStatus
 *
 * Polls the server `/api/status` endpoint to track connection health
 * and runtime state. Uses fast retries on startup (1s intervals for
 * 15 seconds) then settles into 5s polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, RuntimeStatus } from "../types";

import { API_BASE } from "../config";

/** Normal polling interval once connected. */
const POLL_INTERVAL = 5000;
/** Fast retry interval during startup. */
const RETRY_INTERVAL = 1000;
/** Number of fast retries before switching to normal polling. */
const MAX_FAST_RETRIES = 15;

export function useStatus() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({
    connected: false,
  });
  const fastRetriesLeft = useRef(MAX_FAST_RETRIES);

  const check = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${API_BASE}/api/status`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Status check failed");
      const data = (await res.json()) as Record<string, unknown>;
      setRuntimeStatus({ ...data, connected: true } as RuntimeStatus);
      setConnectionStatus("connected");
      fastRetriesLeft.current = 0;
    } catch {
      setConnectionStatus((prev) => {
        // Don't flash "disconnected" on first load — keep initial state
        // until we've exhausted fast retries
        if (fastRetriesLeft.current > 0) return prev;
        return "disconnected";
      });
      setRuntimeStatus({ connected: false });
    } finally {
      clearTimeout(timeout);
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
