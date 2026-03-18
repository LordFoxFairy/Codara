import type {GatewaySessionConfig, InboundMessage, SessionResetPolicy} from './types';
import {buildSessionKey, type SessionKeyOptions} from './session-key';
import {createFileSessionStore, type GatewaySessionStore, type StoredSessionEntry} from './session-store';

export interface GatewaySession {
  invoke(text: string): Promise<string>;
  stream(text: string): AsyncGenerator<string, string, void>;
  dispose(): Promise<void>;
}

export type GatewaySessionFactory = (sessionKey: string, profile?: string) => Promise<GatewaySession>;

export interface GatewaySessionManager {
  getOrCreate(msg: InboundMessage, profile?: string): Promise<{session: GatewaySession; sessionKey: string}>;
  get(sessionKey: string): GatewaySession | undefined;
  remove(sessionKey: string): Promise<void>;
  activeCount(): number;
  disposeAll(): Promise<void>;
}

export function createGatewaySessionManager(options: {
  createSession: GatewaySessionFactory;
  sessionConfig?: GatewaySessionConfig;
}): GatewaySessionManager {
  const sessions = new Map<string, GatewaySession>();
  const maxSessions = options.sessionConfig?.maxSessions ?? 100;
  const store: GatewaySessionStore = createFileSessionStore(options.sessionConfig?.persistDir);
  const keyOptions: SessionKeyOptions = {
    dmScope: options.sessionConfig?.dmScope ?? 'per-channel-peer',
    identityLinks: options.sessionConfig?.identityLinks,
  };
  const defaultResetPolicy: SessionResetPolicy = options.sessionConfig?.resetPolicy ?? {mode: 'idle', idleMinutes: 120};

  function getResetPolicy(peerKind: 'direct' | 'group' | 'channel'): SessionResetPolicy {
    if (peerKind === 'direct' && options.sessionConfig?.resetByType?.direct) {
      return options.sessionConfig.resetByType.direct;
    }
    if ((peerKind === 'group' || peerKind === 'channel') && options.sessionConfig?.resetByType?.group) {
      return options.sessionConfig.resetByType.group;
    }
    return defaultResetPolicy;
  }

  return {
    async getOrCreate(msg, profile) {
      const sessionKey = buildSessionKey(msg, keyOptions);

      // Check in-memory cache
      let session = sessions.get(sessionKey);
      if (session) {
        // Update last activity
        const stored = await store.get(sessionKey);
        if (stored) {
          stored.lastActivityAt = Date.now();
          await store.save(stored);
        }
        return {session, sessionKey};
      }

      // Check persistent store for reset
      const stored = await store.get(sessionKey);
      if (stored) {
        const policy = getResetPolicy(msg.peer.kind);
        if (store.shouldReset(stored, policy)) {
          await store.remove(sessionKey);
          // Will create fresh session below
        }
      }

      // Evict if at capacity
      if (sessions.size >= maxSessions) {
        const oldest = sessions.keys().next().value;
        if (oldest) {
          const evicted = sessions.get(oldest);
          sessions.delete(oldest);
          await evicted?.dispose();
        }
      }

      // Create new session
      session = await options.createSession(sessionKey, profile);
      sessions.set(sessionKey, session);

      // Persist entry
      await store.save({
        sessionKey,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        channel: msg.channel,
        peerId: msg.sender.id,
        peerKind: msg.peer.kind,
        displayName: msg.sender.name,
      });

      return {session, sessionKey};
    },

    get(sessionKey) {
      return sessions.get(sessionKey);
    },

    async remove(sessionKey) {
      const session = sessions.get(sessionKey);
      sessions.delete(sessionKey);
      await session?.dispose();
      await store.remove(sessionKey);
    },

    activeCount() {
      return sessions.size;
    },

    async disposeAll() {
      const promises = [...sessions.values()].map((s) => s.dispose());
      await Promise.allSettled(promises);
      sessions.clear();
    },
  };
}
