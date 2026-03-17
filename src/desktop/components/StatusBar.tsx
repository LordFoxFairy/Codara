import type { ConnectionStatus, RuntimeStatus } from "../types";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  runtimeStatus: RuntimeStatus;
}

export function StatusBar({
  connectionStatus,
  runtimeStatus,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t border-gray-800 bg-gray-950 px-4 py-1.5 text-xs text-gray-500">
      <div className="flex items-center gap-3">
        {/* Connection indicator */}
        <span className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-emerald-500"
                : connectionStatus === "error"
                  ? "bg-red-500"
                  : "bg-gray-600"
            }`}
          />
          {connectionStatus === "connected"
            ? "Connected"
            : connectionStatus === "error"
              ? "Error"
              : "Disconnected"}
        </span>

        {/* Model */}
        {runtimeStatus.model && (
          <span className="text-gray-600">
            {runtimeStatus.model}
          </span>
        )}
      </div>

      {/* Token usage */}
      <div>
        {runtimeStatus.tokensUsed != null && runtimeStatus.tokensUsed > 0 && (
          <span>{runtimeStatus.tokensUsed.toLocaleString()} tokens</span>
        )}
      </div>
    </div>
  );
}
