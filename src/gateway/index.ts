/**
 * @module gateway
 *
 * Public API for the IM message gateway.
 * Re-exports all types and factory functions needed to construct and
 * configure a Gateway instance programmatically.
 */

export {Gateway} from './gateway';
export {createCodaraSessionFactory} from './codara-session-factory';
export type {CodaraSessionFactoryOptions} from './codara-session-factory';
export type {GatewayOptions} from './gateway';
export {createGatewayRouter} from './router';
export type {GatewayRouter} from './router';
export {createGatewaySessionManager} from './session-manager';
export type {GatewaySession, GatewaySessionFactory, GatewaySessionManager} from './session-manager';
export {buildSessionKey} from './session-key';
export type {SessionKeyOptions} from './session-key';
export {createFileSessionStore} from './session-store';
export type {GatewaySessionStore, StoredSessionEntry} from './session-store';
export {chunkText, chunkMarkdown} from './outbound';
export type {ChunkOptions} from './outbound';
export {createDebouncedHandler} from './debounce';
export type {DebounceOptions, DebouncedHandler} from './debounce';
export {loadGatewayConfig} from './config';
export type {
  InboundMessage,
  OutboundContext,
  OutboundMediaContext,
  ReviewPromptContext,
  ReviewPromptAction,
  SendResult,
  StopHandle,
  GatewayConfig,
  ChannelAccountsConfig,
  GatewayBinding,
  DmScope,
  IdentityLinks,
  SessionResetPolicy,
  GatewaySessionConfig,
} from './types';
