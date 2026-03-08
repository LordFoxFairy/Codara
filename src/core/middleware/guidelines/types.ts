import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';

export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
  /** 是否被截断 */
  truncated?: boolean;
  /** 原始总行数（如果被截断） */
  totalLines?: number;
}

export type GuidelineFile = WorkspaceScopedFile;

export interface GuidelinesOptions extends WorkspaceFileOptions {
  /** 最大行数限制，默认 500 行（对齐渐进披露原则） */
  maxLines?: number;
  /** 截断提示消息 */
  truncateMessage?: string;
}
