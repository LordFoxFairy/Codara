import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';

export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
}

export type GuidelineFile = WorkspaceScopedFile;
export type GuidelinesOptions = WorkspaceFileOptions;
