import type {FeishuSendResult} from './types';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const SEND_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';
const REPLY_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';

/** Safety margin: refresh 5 minutes before actual expiry. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class FeishuApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    public readonly description: string,
  ) {
    super(`Feishu API error [${method}] ${code}: ${description}`);
    this.name = 'FeishuApiError';
  }
}

export class FeishuApi {
  private cachedToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  /**
   * Get tenant_access_token, using cache when possible.
   * Feishu tokens expire in ~2 hours; we refresh 5 minutes early.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({app_id: this.appId, app_secret: this.appSecret}),
    });

    const data = (await res.json()) as {
      code: number;
      msg: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (data.code !== 0 || !data.tenant_access_token) {
      throw new FeishuApiError('getAccessToken', data.code, data.msg);
    }

    this.cachedToken = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    return this.cachedToken;
  }

  /**
   * Send a message to a user or chat.
   *
   * @param receiveId - Target user/chat ID
   * @param receiveIdType - 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'
   * @param content - JSON string of message content
   * @param msgType - 'text' | 'post' | 'interactive' | 'image' etc.
   */
  async sendMessage(
    receiveId: string,
    receiveIdType: string,
    content: string,
    msgType: string,
  ): Promise<FeishuSendResult> {
    const token = await this.getAccessToken();
    const url = `${SEND_URL}?receive_id_type=${receiveIdType}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({receive_id: receiveId, msg_type: msgType, content}),
    });

    const data = (await res.json()) as FeishuSendResult;
    if (data.code !== 0) {
      throw new FeishuApiError('sendMessage', data.code, data.msg);
    }
    return data;
  }

  /**
   * Reply to a specific message.
   */
  async replyMessage(
    messageId: string,
    content: string,
    msgType: string,
  ): Promise<FeishuSendResult> {
    const token = await this.getAccessToken();
    const url = `${REPLY_URL}/${messageId}/reply`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({msg_type: msgType, content}),
    });

    const data = (await res.json()) as FeishuSendResult;
    if (data.code !== 0) {
      throw new FeishuApiError('replyMessage', data.code, data.msg);
    }
    return data;
  }

  /** Invalidate cached token (useful for testing or forced refresh). */
  invalidateToken(): void {
    this.cachedToken = undefined;
    this.tokenExpiresAt = 0;
  }
}
