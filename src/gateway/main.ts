import {Gateway} from './gateway';
import {loadGatewayConfig} from './config';
import {createCodaraSessionFactory} from './codara-session-factory';

export async function startGateway(configPath?: string): Promise<Gateway> {
  const config = await loadGatewayConfig(configPath);

  // Dynamically import all available channel plugins
  const pluginImports = [
    () => import('@integration/channel/telegram').then(m => m.telegramPlugin),
    () => import('@integration/channel/feishu').then(m => m.feishuPlugin),
    () => import('@integration/channel/dingtalk').then(m => m.dingtalkPlugin),
    () => import('@integration/channel/qq').then(m => m.qqPlugin),
    () => import('@integration/channel/wecom').then(m => m.wecomPlugin),
    () => import('@integration/channel/discord').then(m => m.discordPlugin),
    () => import('@integration/channel/slack').then(m => m.slackPlugin),
  ];

  const plugins = [];
  for (const importPlugin of pluginImports) {
    try {
      plugins.push(await importPlugin());
    } catch { /* plugin not available */ }
  }

  const gateway = new Gateway({
    config,
    plugins,
    createSession: createCodaraSessionFactory({cwd: process.cwd()}),
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
