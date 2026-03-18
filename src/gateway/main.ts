import {Gateway} from './gateway';
import {loadGatewayConfig} from './config';

export async function startGateway(configPath?: string): Promise<Gateway> {
  const config = await loadGatewayConfig(configPath);

  // Dynamically import available plugins
  const plugins = [];
  try {
    const {telegramPlugin} = await import('@integration/channel/telegram');
    plugins.push(telegramPlugin);
  } catch {
    /* telegram not available */
  }

  const gateway = new Gateway({
    config,
    plugins,
    createSession: async (_key, _profile) => ({
      invoke: async (text: string) => `[Echo] ${text}`,
      dispose: async () => {},
    }),
  });
  await gateway.start();

  const enabledChannels = Object.entries(config.channels)
    .filter(([, c]) => c.enabled)
    .map(([id]) => id);
  console.log(`[Gateway] Started — channels: ${enabledChannels.join(', ') || 'none'}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Gateway] Shutting down...');
    await gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return gateway;
}

if (import.meta.main) {
  startGateway().catch((error) => {
    console.error('[Gateway] Fatal:', error);
    process.exit(1);
  });
}
