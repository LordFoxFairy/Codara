/**
 * Centralized CLI color theme and shared visual constants.
 *
 * All semantic colors and spinner constants are defined here so that
 * individual components reference a single source of truth rather than
 * hard-coding color strings or animation parameters.
 */

// ── Spinner constants (shared across all animated indicators) ──
export const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const SPINNER_INTERVAL_MS = 80;

// ── Semantic tokens ────────────────────────────────────────────
export const theme = {
  // Roles (transcript, labels)
  role: {
    system: 'cyan',
    warning: 'yellow',
    user: 'green',
    assistant: 'magenta',
    tool: 'blueBright',
    agent: 'yellowBright',
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
