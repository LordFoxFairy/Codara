export interface FeishuEvent {
  schema?: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: FeishuMessageEvent | FeishuUrlVerificationEvent | Record<string, unknown>;
}

export interface FeishuMessageEvent {
  sender: {
    sender_id: {open_id?: string; user_id?: string; union_id?: string};
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string; // JSON string
    create_time?: string;
    mentions?: Array<{key: string; id: {open_id?: string}; name: string}>;
  };
}

export interface FeishuUrlVerificationEvent {
  challenge: string;
  token: string;
  type: 'url_verification';
}

export interface FeishuAccountConfig {
  appId: string;
  appSecret: string;
  verifyToken?: string;
  encryptKey?: string;
  webhookPort?: number;
  webhookPath?: string;
}

export interface FeishuSendResult {
  code: number;
  msg: string;
  data?: {message_id: string};
}
