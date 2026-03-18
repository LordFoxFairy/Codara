import type {ZodType} from 'zod';
import type {
  InboundMessage,
  OutboundContext,
  OutboundMediaContext,
  PausePromptContext,
  SendResult,
  StopHandle,
} from '@gateway/types';

export interface ChannelPluginCapabilities {
  chatTypes: ('direct' | 'group' | 'channel')[];
  streaming: boolean;
  threads: boolean;
  media: boolean;
  reactions: boolean;
  textLimit: number;
}

export interface GatewayListenContext<TAccount = unknown> {
  account: TAccount;
  accountId: string;
  config: Record<string, unknown>;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onPauseResponse?: (pauseId: string, payload: unknown) => void;
}

export interface ChannelPlugin<TAccount = unknown> {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ChannelPluginCapabilities;

  configSchema: ZodType;
  resolveAccount(config: Record<string, unknown>, accountId?: string): TAccount | undefined;

  startListening(ctx: GatewayListenContext<TAccount>): Promise<StopHandle>;

  sendText(account: TAccount, ctx: OutboundContext): Promise<SendResult>;
  sendMedia?(account: TAccount, ctx: OutboundMediaContext): Promise<SendResult>;
  sendTyping?(account: TAccount, ctx: OutboundContext): Promise<void>;
  sendPausePrompt?(account: TAccount, ctx: PausePromptContext): Promise<SendResult>;
}
