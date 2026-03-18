import type {
  WeComTokenResponse,
  WeComSendResponse,
  WeComSendPayload,
  WeComCardButton,
} from './types';

const TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken';
const SEND_URL = 'https://qyapi.weixin.qq.com/cgi-bin/message/send';

/** Safety margin: refresh 5 minutes before actual expiry. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class WeComApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly errcode: number,
    public readonly errmsg: string,
  ) {
    super(`WeCom API error [${method}] ${errcode}: ${errmsg}`);
    this.name = 'WeComApiError';
  }
}

export class WeComApi {
  private cachedToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(
    private readonly corpId: string,
    private readonly corpSecret: string,
    private readonly agentId: number,
  ) {}

  /**
   * Get access_token, using cache when possible.
   * WeCom tokens expire in 7200 seconds (2 hours); we refresh 5 minutes early.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const url = `${TOKEN_URL}?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.corpSecret)}`;
    const res = await fetch(url);
    const data = (await res.json()) as WeComTokenResponse;

    if (data.errcode !== 0 || !data.access_token) {
      throw new WeComApiError('getAccessToken', data.errcode, data.errmsg);
    }

    this.cachedToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 7200) * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    return this.cachedToken;
  }

  /**
   * Send a text message to one or more users.
   */
  async sendTextMessage(toUser: string, content: string): Promise<WeComSendResponse> {
    return this.send({
      touser: toUser,
      msgtype: 'text',
      agentid: this.agentId,
      text: {content},
    });
  }

  /**
   * Send a markdown message to one or more users.
   * WeCom markdown supports: bold, links, headings, quotes, etc.
   */
  async sendMarkdownMessage(toUser: string, content: string): Promise<WeComSendResponse> {
    return this.send({
      touser: toUser,
      msgtype: 'markdown',
      agentid: this.agentId,
      markdown: {content},
    });
  }

  /**
   * Send a template card with buttons (used for HIL pause prompts).
   */
  async sendTemplateCard(
    toUser: string,
    title: string,
    subtitle: string,
    buttons: WeComCardButton[],
  ): Promise<WeComSendResponse> {
    return this.send({
      touser: toUser,
      msgtype: 'template_card',
      agentid: this.agentId,
      template_card: {
        card_type: 'button_interaction',
        main_title: {title},
        sub_title_text: subtitle,
        button_list: buttons,
      },
    });
  }

  /** Invalidate cached token (useful for testing or forced refresh). */
  invalidateToken(): void {
    this.cachedToken = undefined;
    this.tokenExpiresAt = 0;
  }

  private async send(payload: WeComSendPayload): Promise<WeComSendResponse> {
    const token = await this.getAccessToken();
    const url = `${SEND_URL}?access_token=${encodeURIComponent(token)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as WeComSendResponse;
    if (data.errcode !== 0) {
      throw new WeComApiError('send', data.errcode, data.errmsg);
    }
    return data;
  }
}
