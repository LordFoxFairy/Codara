import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { Sidebar, type NavPage } from "./components/Sidebar";
import { ContentHeader } from "./components/ContentHeader";
import { Chat } from "./components/Chat";
import { InputArea } from "./components/InputArea";
import { useCodara } from "./hooks/useCodara";
import { useSessions } from "./hooks/useSessions";
import { useStatus } from "./hooks/useStatus";

export function App() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activePage, setActivePage] = useState<NavPage>("chat");
  const [errorVisible, setErrorVisible] = useState(false);

  const { sessions, loading: sessionsLoading, createSession, loadMessages } = useSessions();
  const { connectionStatus, runtimeStatus, check: refreshStatus } = useStatus();
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
    restoreMessages,
  } = useCodara({ sessionId: currentSessionId });

  // Current active session — always shown in sidebar even if empty
  const [activeSession, setActiveSession] = useState<import("./types").Session | null>(null);

  // Build display list: active session + historical sessions with messages
  const displaySessions = useMemo(() => {
    const list = [...sessions];
    if (activeSession && !list.some((s) => s.id === activeSession.id)) {
      list.unshift(activeSession);
    }
    return list;
  }, [sessions, activeSession]);

  // Auto-create first session on startup
  useEffect(() => {
    if (!sessionsLoading && !currentSessionId) {
      void createSession().then((session) => {
        if (session) {
          setCurrentSessionId(session.id);
          setActiveSession(session);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsLoading]);

  // Error toast auto-dismiss
  useEffect(() => {
    if (error) {
      setErrorVisible(true);
      const timer = setTimeout(() => setErrorVisible(false), 6000);
      return () => clearTimeout(timer);
    }
    setErrorVisible(false);
  }, [error]);

  const handleNewChat = useCallback(async () => {
    const session = await createSession();
    if (session) {
      setCurrentSessionId(session.id);
      setActiveSession(session);
      clearMessages();
    }
  }, [createSession, clearMessages]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (id !== currentSessionId) {
        setCurrentSessionId(id);
        // Update active session ref
        const found = sessions.find((s) => s.id === id);
        if (found) setActiveSession(found);
        clearMessages();
        // Load conversation history from checkpoint
        const history = await loadMessages(id);
        if (history.length > 0) {
          restoreMessages(history);
        }
      }
    },
    [currentSessionId, sessions, clearMessages, loadMessages, restoreMessages],
  );

  const handleNavigate = useCallback((page: NavPage) => {
    setActivePage(page);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-surface)]">
      {/* ── Global top bar ────────────────────────────── */}
      <TopBar
        connectionStatus={connectionStatus}
        runtimeStatus={runtimeStatus}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        onRefresh={() => void refreshStatus()}
      />

      {/* ── Body: sidebar + content ───────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar navigation */}
        <Sidebar
          sessions={displaySessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          loading={sessionsLoading}
          collapsed={sidebarCollapsed}
          activePage={activePage}
          onNavigate={handleNavigate}
        />

        {/* Main content */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Content header */}
          <ContentHeader
            title="Chat"
            subtitle="Direct chat session for quick interactions."
            agentLabel="codara:main"
          />

          {/* Error banner */}
          {error && errorVisible && (
            <div className="animate-fade-in border-b border-red-200 bg-red-50 px-4 py-2">
              <div className="mx-auto flex max-w-4xl items-center gap-2 text-[13px] text-red-600">
                <AlertCircle size={14} strokeWidth={2} className="shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                <button
                  onClick={() => setErrorVisible(false)}
                  className="shrink-0 rounded p-0.5 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}

          {/* Chat messages */}
          <Chat
            messages={messages}
            status={status}
            pauseRequest={pauseRequest}
            onResume={resumePause}
          />

          {/* Input bar */}
          <InputArea
            onSend={sendMessage}
            disabled={isStreaming || status === "paused"}
            onStop={stopStreaming}
            isStreaming={isStreaming}
            onNewSession={handleNewChat}
          />
        </main>
      </div>
    </div>
  );
}
