import { BookOpen, Terminal, Zap, Shield, Cpu } from "lucide-react";

const DOCS = [
  {
    title: "Getting Started",
    description: "Quick start guide for Codara CLI and Desktop app",
    icon: BookOpen,
    items: [
      "Install: bun install && bun run dev",
      "Desktop: bun run desktop",
      "CLI: bun run cli",
    ],
  },
  {
    title: "Commands",
    description: "Built-in slash commands available in chat",
    icon: Terminal,
    items: [
      "/help — Show available commands",
      "/status — Current runtime status",
      "/resume — Resume a previous session",
      "/clear — Clear the conversation",
      "/model — Switch model at runtime",
      "/cost — Show token usage and cost",
    ],
  },
  {
    title: "Skills",
    description: "Extensible skill system for specialized tasks",
    icon: Zap,
    items: [
      "Skills are defined in .codara/skills/",
      "Each skill has a manifest.json and handler",
      "Skills can register custom tools and middleware",
      "MCP servers provide external tool integration",
    ],
  },
  {
    title: "Configuration",
    description: "Customize Codara behavior via config files",
    icon: Shield,
    items: [
      ".codara/config.json — Main configuration",
      ".codara/models.json — Model routing rules",
      "CLAUDE.md / CODARA.md — Project instructions",
      "Environment: CODARA_SERVER_PORT, ANTHROPIC_API_KEY",
    ],
  },
  {
    title: "Architecture",
    description: "How Codara components connect",
    icon: Cpu,
    items: [
      "CodaraBus — Central event bus (ws://localhost:23981)",
      "CLI Client — Terminal UI via Ink + React",
      "Desktop Client — Tauri/Vite + React web UI",
      "Agent Engine — LangChain-based agent with checkpointing",
      "Session Store — File-based persistence in .codara/sessions/",
    ],
  },
];

export function DocsPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6 space-y-5">
        {DOCS.map((section) => {
          const Icon = section.icon;
          return (
            <div
              key={section.title}
              className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]"
            >
              <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3">
                <Icon size={16} strokeWidth={1.75} className="text-[var(--color-accent)]" />
                <div>
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {section.title}
                  </span>
                  <span className="ml-2 text-[11px] text-[var(--color-text-tertiary)]">
                    {section.description}
                  </span>
                </div>
              </div>
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {section.items.map((item, i) => (
                  <li key={i} className="px-5 py-2.5 text-[12px] text-[var(--color-text-secondary)]">
                    <code className="rounded bg-[var(--color-surface-alt)] px-1 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)]">
                      {item.split(" — ")[0]}
                    </code>
                    {item.includes(" — ") && (
                      <span className="ml-2 text-[var(--color-text-tertiary)]">
                        — {item.split(" — ")[1]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
