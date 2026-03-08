export interface AgentsGuidelineFile {
  scope: 'global' | 'project';
  path: string;
}

export interface AgentsGuidelines {
  files: AgentsGuidelineFile[];
  content: string;
}

export interface AgentsGuidelinesOptions {
  userHome?: string;
  projectRoot?: string;
}
