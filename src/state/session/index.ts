/**
 * Session durability barrel.
 *
 * Re-exports session creation, metadata types, transcript I/O, storage
 * helpers, and the session restore fallback.
 *
 * @module
 */

export type {
  Session,
  ConversationCompactionResult,
} from '@state/session/session';
export type {
  SessionMetadata,
  SessionState,
  SessionStatus,
} from '@state/session/types';
export {createSession} from '@state/session/session';
export type {SessionStore, SessionListOptions} from '@state/session/store';
export {FileSessionStore} from '@state/session/store';
export type {TranscriptEntry, TranscriptSessionMetadata} from '@state/session/types';
export {TranscriptWriter, TranscriptReader} from '@state/session/transcript';
export {getTranscriptPath, listSessionTranscripts} from '@state/session/storage';
export {restoreSession, type RestoredSession} from '@state/session/restore';
