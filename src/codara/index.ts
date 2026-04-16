/**
 * Package barrel -- re-exports the public Codara API surface.
 *
 * Consumers should import from `@codara` (this module), not from
 * individual files like `facade.ts` or `types.ts`.
 */

export type {
  Codara,
  CodaraContinuationStreamRequest,
  CodaraReviewOptions,
  CodaraRuntimeOptions,
  CodaraOptions,
  CodaraPromptStreamRequest,
  CodaraReviewStreamRequest,
  CodaraStreamRequest,
  ReviewBlockingScope,
  ReviewQueryItem,
  FocusedReviewQuery,
  SubagentRunQuerySummary,
  SubagentRunQueryDetail,
} from '@codara/facade';
export {
  CodaraModelCatalog,
  createCodara,
  createCodaraChatModel,
  createCodaraRuntime,
  createCodaraModelCatalog,
  DEFAULT_CODARA_MODEL_ALIAS,
  openCodaraSession,
  openLatestCodaraSession,
} from '@codara/facade';
