import {afterEach, describe, expect, it} from 'bun:test';
import {createFetchTool} from '@core/tools';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('FetchTool - Generic HTTP Client', () => {
  it('should reject non-http protocols', async () => {
    const tool = createFetchTool();
    const result = await tool.invoke({url: 'file:///etc/passwd'});

    expect(String(result)).toContain('Unsupported protocol');
    expect(String(result)).toContain('file:');
  });

  it('should support GET requests and return JSON', async () => {
    globalThis.fetch = async () => {
      return new Response('Hello World', {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com'});
    const parsed = JSON.parse(result);

    expect(parsed.url).toBe('https://example.com/');
    expect(parsed.status).toBe(200);
    expect(parsed.statusText).toBe('OK');
    expect(parsed.headers['content-type']).toBe('text/plain');
    expect(parsed.body).toBe('Hello World');
  });

  it('should support POST with body and headers', async () => {
    let capturedRequest: {method: string; headers: Record<string, string>; body: string} | null = null;

    globalThis.fetch = async (url, options) => {
      capturedRequest = {
        method: options?.method || 'GET',
        headers: options?.headers as Record<string, string> || {},
        body: options?.body as string || '',
      };

      return new Response('{"success":true}', {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'application/json'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer token'},
      body: '{"key":"value"}',
    });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest?.method).toBe('POST');
    expect(capturedRequest?.headers['Content-Type']).toBe('application/json');
    expect(capturedRequest?.headers['Authorization']).toBe('Bearer token');
    expect(capturedRequest?.body).toBe('{"key":"value"}');

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe(200);
    expect(parsed.body).toBe('{"success":true}');
  });

  it('should return raw HTML without processing', async () => {
    const html = '<!doctype html><html><head><title>Demo</title></head><body><h1>Hello</h1></body></html>';
    globalThis.fetch = async () => {
      return new Response(html, {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'text/html; charset=utf-8'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/page'});
    const parsed = JSON.parse(result);

    // Should return raw HTML, not processed text
    expect(parsed.body).toBe(html);
    expect(parsed.body).toContain('<title>Demo</title>');
    expect(parsed.body).toContain('<h1>Hello</h1>');
  });

  it('should enforce response size limit', async () => {
    globalThis.fetch = async () => {
      return new Response('A'.repeat(2000), {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({
      url: 'https://example.com/large',
      max_response_size: 100,
    });

    expect(String(result)).toContain('Response too large');
    expect(String(result)).toContain('2000 bytes');
    expect(String(result)).toContain('exceeds limit of 100 bytes');
  });

  it('should handle timeout', async () => {
    globalThis.fetch = async (url, options) => {
      // Wait for abort signal
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response('Too slow', {status: 200}));
        }, 1000);

        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({
      url: 'https://example.com/slow',
      timeout_ms: 50,
    });

    expect(String(result)).toContain('Request timeout');
    expect(String(result)).toContain('50ms');
  });

  it('should return all HTTP status codes (including errors)', async () => {
    globalThis.fetch = async () => {
      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/missing'});
    const parsed = JSON.parse(result);

    // Should return the response, not an error
    expect(parsed.status).toBe(404);
    expect(parsed.statusText).toBe('Not Found');
    expect(parsed.body).toBe('Not Found');
  });

  it('should handle network errors', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network error: Connection refused');
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'https://example.com/error'});

    expect(String(result)).toContain('Request failed');
    expect(String(result)).toContain('Network error');
  });

  it('should validate URL format', async () => {
    const tool = createFetchTool();
    const result = await tool.invoke({url: 'not-a-valid-url'});

    expect(String(result)).toContain('Invalid URL');
  });

  it('should allow localhost (no security blocking)', async () => {
    globalThis.fetch = async () => {
      return new Response('Local server', {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'http://localhost:3000'});
    const parsed = JSON.parse(result);

    // Should NOT block localhost
    expect(parsed.status).toBe(200);
    expect(parsed.body).toBe('Local server');
  });

  it('should allow private IP addresses (no security blocking)', async () => {
    globalThis.fetch = async () => {
      return new Response('Private network', {
        status: 200,
        statusText: 'OK',
        headers: {'content-type': 'text/plain'},
      });
    };

    const tool = createFetchTool();
    const result = await tool.invoke({url: 'http://192.168.1.10'});
    const parsed = JSON.parse(result);

    // Should NOT block private IPs
    expect(parsed.status).toBe(200);
    expect(parsed.body).toBe('Private network');
  });
});

