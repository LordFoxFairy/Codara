/**
 * @module bus
 *
 * Event bus layer — bridges the Codara runtime with network transports.
 *
 * - {@link CodaraBus} owns the runtime and emits typed events.
 * - {@link BusClient} is the WebSocket SDK for remote consumers.
 * - {@link TypedEmitter} is a generic single-channel event emitter.
 */
export {TypedEmitter} from './event-emitter';
export {CodaraBus} from './bus';
export {BusClient} from './client';
export type {
  BusClientInfo,
  BusConfig,
  BusEvent,
  BusRequest,
  ClientId,
} from './types';
