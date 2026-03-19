/** WeCom account configuration from gateway config. */
export interface WeComAccountConfig {
  corpId: string;
  corpSecret: string;
  agentId: number;
  token: string;
  encodingAESKey: string;
  webhookPort?: number;
  webhookPath?: string;
}

/** Parsed WeCom inbound message (after XML decryption). */
export interface WeComMessageEvent {
  ToUserName: string;
  FromUserName: string;
  CreateTime: string;
  MsgType: string;
  Content?: string;
  MsgId?: string;
  AgentID?: string;
  Event?: string;
  EventKey?: string;
  TaskId?: string;
}

/** WeCom access token response. */
export interface WeComTokenResponse {
  errcode: number;
  errmsg: string;
  access_token?: string;
  expires_in?: number;
}

/** WeCom send message response. */
export interface WeComSendResponse {
  errcode: number;
  errmsg: string;
  msgid?: string;
}

/** WeCom text message payload. */
export interface WeComTextPayload {
  touser: string;
  msgtype: 'text';
  agentid: number;
  text: {content: string};
}

/** WeCom markdown message payload. */
export interface WeComMarkdownPayload {
  touser: string;
  msgtype: 'markdown';
  agentid: number;
  markdown: {content: string};
}

/** WeCom template card button. */
export interface WeComCardButton {
  text: string;
  style: number;
  key: string;
}

/** WeCom template card payload. */
export interface WeComTemplateCardPayload {
  touser: string;
  msgtype: 'template_card';
  agentid: number;
  template_card: {
    card_type: 'button_interaction';
    main_title: {title: string};
    sub_title_text: string;
    button_list: WeComCardButton[];
  };
}

export type WeComSendPayload = WeComTextPayload | WeComMarkdownPayload | WeComTemplateCardPayload;
