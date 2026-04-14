// Re-export all for backward compatibility
export type {NormalizedBashCommand} from './bash-parser';
export {
  tokenizeShellCommand,
  stripLeadingShellEnvironment,
  stripShellRedirections,
  unwrapShellLauncherCommand,
  normalizeBashCommandTokens,
  splitCompoundShellCommands,
  prepareShellCommand,
  isStandaloneShellRedirection,
  isInlineShellRedirection,
  isStandaloneShellWriteRedirection,
  readInlineShellWriteRedirectionTarget,
  isShellDescriptorTarget,
  SHELL_LAUNCHER_COMMANDS,
} from './bash-parser';
export {
  normalizeBashCommandForMatching,
  bashSpecifierMatches,
  normalizeCompoundBashCommands,
} from './bash-matcher';
export {
  formatBashToolScopeExpression,
  extractBashWritePathOperands,
  extractBashAlwaysPatterns,
} from './bash-scope';
