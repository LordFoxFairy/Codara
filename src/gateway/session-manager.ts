export interface GatewaySession {
  invoke(text: string): Promise<string>;
  stream(text: string): AsyncGenerator<string, string, void>;
  dispose(): Promise<void>;
}

export interface GatewaySessionFactory {
  (sessionKey: string, profile?: string): Promise<GatewaySession>;
}

export interface GatewaySessionManager {
  getOrCreate(sessionKey: string, profile?: string): Promise<GatewaySession>;
  get(sessionKey: string): GatewaySession | undefined;
  remove(sessionKey: string): Promise<void>;
  activeCount(): number;
  disposeAll(): Promise<void>;
}

export function createGatewaySessionManager(options: {
  createSession: GatewaySessionFactory;
  maxSessions?: number;
}): GatewaySessionManager {
  const sessions = new Map<string, GatewaySession>();
  const maxSessions = options.maxSessions ?? 100;

  return {
    async getOrCreate(sessionKey, profile) {
      let session = sessions.get(sessionKey);
      if (session) return session;

      if (sessions.size >= maxSessions) {
        const oldest = sessions.keys().next().value;
        if (oldest) {
          const evicted = sessions.get(oldest);
          sessions.delete(oldest);
          await evicted?.dispose();
        }
      }

      session = await options.createSession(sessionKey, profile);
      sessions.set(sessionKey, session);
      return session;
    },

    get(sessionKey) {
      return sessions.get(sessionKey);
    },

    async remove(sessionKey) {
      const session = sessions.get(sessionKey);
      sessions.delete(sessionKey);
      await session?.dispose();
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
