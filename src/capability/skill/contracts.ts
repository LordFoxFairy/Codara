export interface SkillCommandMetadata {
  name: string;
  description?: string;
  usage?: string;
  aliases?: string[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  license?: string | null;
  compatibility?: string | null;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  command?: SkillCommandMetadata;
  frontmatter?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface SkillStore {
  discover(): Promise<SkillMetadata[]>;
  listSources?(): string[];
  refresh?(): Promise<void> | void;
}

export interface SubagentDefinitionHints {
  model?: string;
  middlewareNames?: string[];
  permissionMode?: string;
}

export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  maxTurns?: number;
  hints?: SubagentDefinitionHints;
}

export interface SkillsRuntimeData {
  sources: string[];
  discovered: SkillMetadata[];
  subagentDefinitions: Record<string, SubagentDefinition>;
}

export interface SkillsSource {
  getRuntime(): Promise<SkillsRuntimeData>;
  reload(): void;
}
