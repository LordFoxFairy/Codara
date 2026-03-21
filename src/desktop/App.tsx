import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { Sidebar, type NavPage } from "./components/Sidebar";
import { ContentHeader } from "./components/ContentHeader";
import { Chat } from "./components/Chat";
import { InputArea } from "./components/InputArea";
import { SessionsPage } from "./pages/SessionsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { ConfigPage } from "./pages/ConfigPage";
import { DebugPage } from "./pages/DebugPage";
import { LogsPage } from "./pages/LogsPage";
import { DocsPage } from "./pages/DocsPage";
import { useCodara } from "./hooks/useCodara";
import { useSessions } from "./hooks/useSessions";
import { useStatus } from "./hooks/useStatus";

/* ── Page metadata ───────────────────────────────────────── */

const PAGE_META: Record<NavPage, { title: string; subtitle: string }> = {
  chat: { title: "Chat", subtitle: "Direct chat session for quick interactions." },
  sessions: { title: "Sessions", subtitle: "Browse and restore past conversations." },
  skills: { title: "Skills & Tools", subtitle: "MCP servers, tools, and skill registry." },
  config: { title: "Configuration", subtitle: "Runtime settings, models, and providers." },
  debug: { title: "Debug", subtitle: "Command runner and runtime inspector." },
  logs: { title: "Logs", subtitle: "Live runtime event stream." },
  docs: { title: "Documentation", subtitle: "Quick reference for Codara features." },
};

/* ── App ─────────────────────────────────────────────────── */

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
    runtimeEvent,
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
      setActivePage("chat");
    }
  }, [createSession, clearMessages]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (id !== currentSessionId) {
        setCurrentSessionId(id);
        const found = sessions.find((s) => s.id === id);
        if (found) setActiveSession(found);
        clearMessages();
        const history = await loadMessages(id);
        if (history.length > 0) {
          restoreMessages(history);
        }
      }
      setActivePage("chat");
    },
    [currentSessionId, sessions, clearMessages, loadMessages, restoreMessages],
  );

  const handleNavigate = useCallback((page: NavPage) => {
    setActivePage(page);
  }, []);

  // Open session from Sessions page → switch to chat
  const handleOpenSession = useCallback(
    (id: string) => {
      void handleSelectSession(id);
    },
    [handleSelectSession],
  );

  const pageMeta = PAGE_META[activePage];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-surface)]">
      {/* ── Global top bar ────────────────────────────── */}
      <TopBar
        connectionStatus={connectionStatus}
        runtimeStatus={runtimeStatus}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        onRefresh={() => void refreshStatus()}
        onOpenDebug={() => setActivePage("debug")}
      />

      {/* ── Body: sidebar + content ───────────────────── */}
      <div className="flex min-h-0 flex-1">
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
            title={pageMeta.title}
            subtitle={pageMeta.subtitle}
            agentLabel={activePage === "chat" ? "codara:main" : undefined}
            onRefresh={() => void refreshStatus()}
            onSettings={() => setActivePage("config")}
          />

          {/* Error banner (chat only) */}
          {activePage === "chat" && error && errorVisible && (
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

          {/* ── Page content ─────────────────────────── */}
          {activePage === "chat" && (
            <>
              <Chat
                messages={messages}
                status={status}
                pauseRequest={pauseRequest}
                runtimeEvent={runtimeEvent}
                onResume={resumePause}
              />
              <InputArea
                onSend={sendMessage}
                disabled={isStreaming || status === "paused"}
                onStop={stopStreaming}
                isStreaming={isStreaming}
                onNewSession={handleNewChat}
              />
            </>
          )}
          {activePage === "sessions" && <SessionsPage onOpenSession={handleOpenSession} />}
          {activePage === "skills" && <SkillsPage />}
          {activePage === "config" && <ConfigPage />}
          {activePage === "debug" && <DebugPage />}
          {activePage === "logs" && <LogsPage />}
          {activePage === "docs" && <DocsPage />}
        </main>
      </div>
    </div>
  );
}
