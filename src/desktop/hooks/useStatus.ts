import { useCallback, useEffect, useState } from "react";
import type { ConnectionStatus, RuntimeStatus } from "../types";

const API_BASE = "http://localhost:23981";
const POLL_INTERVAL = 5000;

export function useStatus() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({
    connected: false,
  });

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) throw new Error("Status check failed");
      const data = (await res.json()) as RuntimeStatus;
      setRuntimeStatus({ ...data, connected: true });
      setConnectionStatus("connected");
    } catch {
      setConnectionStatus("disconnected");
      setRuntimeStatus({ connected: false });
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = setInterval(() => void check(), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [check]);

  return { connectionStatus, runtimeStatus, check };
}
