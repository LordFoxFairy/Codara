export interface AgentsGuidelineFile {
  scope: 'global' | 'project';
  path: string;
}

export interface AgentsGuidelines {
  files: AgentsGuidelineFile[];
  content: string;
}

export interface AgentsGuidelinesOptions {
  cwd?: string;
  userHome?: string;
  projectRoot?: string;
}
