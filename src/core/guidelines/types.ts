export interface GuidelineFile {
  scope: 'global' | 'project';
  path: string;
}

export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
}

export interface GuidelinesOptions {
  cwd?: string;
  userHome?: string;
  projectRoot?: string;
}
