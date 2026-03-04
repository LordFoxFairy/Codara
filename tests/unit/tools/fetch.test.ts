import {afterEach, describe, expect, it} from 'bun:test';
import {createFetchTool} from '@core/tools';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('FetchTool', () => {
  it('should reject non-http protocols', async () => {
    const tool = createFetchTool();
    const result = await tool.invoke({url: 'file:///etc/passwd'});

    expect(String(result)).toContain('Invalid URL protocol');
  });

  it('should reject localhost and private hosts', async () => {
    const tool = createFetchTool();

    const localhost = await tool.invoke({url: 'http://localhost:3000'});
    expect(String(localhost)).toContain('Host not allowed');

    const privateIp = await tool.invoke({url: 'http://192.168.1.10/docs'});
    expect(String(privateIp)).toContain('Host not allowed');
  });

  it('should parse html content and strip scripts/styles', async () => {
    globalThis.fetch = async () => {
      return new Response(
        `<!doctype html><html><head><title>Demo Page</title><style>.x{display:none}</style></head><body><script>malicious()</script><h1>Hello</h1><p>World &amp; Everyone</p></body></html>`,
        {
          status: 200,
          statusText: 'OK',
          headers: {'content-type': 'text/html; charset=utf-8'},
        }
      );
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/docs', prompt: 'Summarize key points'});

    expect(String(result)).toContain('Title: Demo Page');
    expect(String(result)).toContain('Prompt: Summarize key points');
    expect(String(result)).toContain('Hello');
    expect(String(result)).toContain('World & Everyone');
    expect(String(result)).not.toContain('malicious');
  });

  it('should format json responses', async () => {
    globalThis.fetch = async () => {
      return new Response('{"ok":true,"items":[1,2]}', {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'application/json'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/api'});

    expect(String(result)).toContain('"ok": true');
    expect(String(result)).toContain('"items": [');
  });

  it('should truncate oversized content', async () => {
    globalThis.fetch = async () => {
      return new Response('A'.repeat(2000), {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/long', max_chars: 100});

    expect(String(result)).toContain('[truncated');
  });

  it('should return readable http error messages', async () => {
    globalThis.fetch = async () => {
      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/missing'});

    expect(String(result)).toContain('Fetch failed');
    expect(String(result)).toContain('HTTP 404 Not Found');
  });
});
