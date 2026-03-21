/**
 * Centralized CLI color theme.
 *
 * All semantic colors are defined here so that individual components
 * reference a single source of truth rather than hard-coding color strings.
 */

// ── Semantic tokens ────────────────────────────────────────────
export const theme = {
  // Roles (transcript, labels)
  role: {
    system: 'cyan',
    warning: 'yellow',
    user: 'green',
    assistant: 'magenta',
    tool: 'blueBright',
    task: 'yellowBright',
    review: 'cyanBright',
    command: 'cyan',
    error: 'red',
  },

  // Status indicators
  status: {
    running: 'yellow',
    thinking: 'yellow',
    responding: 'green',
    done: 'green',
    ready: 'green',
    paused: 'blueBright',
    error: 'red',
    idle: 'gray',
  },

  // Diff view
  diff: {
    addition: 'green',
    deletion: 'red',
    hunkHeader: 'cyan',
  },

  // Interactive elements
  interactive: {
    selection: 'greenBright',
    prompt: 'greenBright',
    title: 'cyan',
    accent: 'cyan',
    danger: 'red',
    primaryButton: 'green',
    secondaryButton: 'blue',
    dangerButton: 'red',
  },

  // Chrome (panels, borders, metadata)
  chrome: {
    border: 'gray',
    dimmed: 'gray',
    mascot: 'yellowBright',
  },
} as const;

export type ThemeRoleColor = typeof theme.role[keyof typeof theme.role];
export type ThemeStatusColor = typeof theme.status[keyof typeof theme.status];
