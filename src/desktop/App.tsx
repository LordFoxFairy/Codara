import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { InputArea } from "./components/InputArea";
import { StatusBar } from "./components/StatusBar";
import { useCodara } from "./hooks/useCodara";
import { useSessions } from "./hooks/useSessions";
import { useStatus } from "./hooks/useStatus";

export function App() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const { sessions, loading: sessionsLoading, createSession } = useSessions();
  const { connectionStatus, runtimeStatus } = useStatus();
  const {
    messages,
    status,
    isStreaming,
    error,
    pauseRequest,
    sendMessage,
    stopStreaming,
    resumePause,
    clearMessages,
  } = useCodara({ sessionId: currentSessionId });

  // Auto-create session if none exist
  useEffect(() => {
    if (!sessionsLoading && sessions.length === 0 && !currentSessionId) {
      void createSession().then((session) => {
        if (session) setCurrentSessionId(session.id);
      });
    }
  }, [sessionsLoading, sessions.length, currentSessionId, createSession]);

  // Auto-select first session
  useEffect(() => {
    if (!currentSessionId && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId]);

  const handleNewChat = useCallback(async () => {
    const session = await createSession();
    if (session) {
      setCurrentSessionId(session.id);
      clearMessages();
    }
  }, [createSession, clearMessages]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id !== currentSessionId) {
        setCurrentSessionId(id);
        clearMessages();
      }
    },
    [currentSessionId, clearMessages],
  );

  return (
    <div className="flex h-full bg-gray-900">
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        loading={sessionsLoading}
      />

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Error banner */}
        {error && (
          <div className="border-b border-red-800/50 bg-red-900/20 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Chat messages */}
        <Chat
          messages={messages}
          status={status}
          pauseRequest={pauseRequest}
          onResume={resumePause}
        />

        {/* Input area */}
        <InputArea
          onSend={sendMessage}
          disabled={isStreaming || status === "paused"}
          onStop={stopStreaming}
          isStreaming={isStreaming}
        />

        {/* Status bar */}
        <StatusBar
          connectionStatus={connectionStatus}
          runtimeStatus={runtimeStatus}
        />
      </div>
    </div>
  );
}
