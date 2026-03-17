import * as os from 'os';

// ─── Types ──────────────────────────────────────────────────────────

/** AgentCard structure per A2A protocol. */
export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    inputModes: string[];
    outputModes: string[];
  }>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

export interface A2AServerConfig {
  host?: string;
  port: number;
  machineName?: string;
}

// ─── Agent Card Builder ─────────────────────────────────────────────

export function buildCodaraAgentCard(config: A2AServerConfig): AgentCard {
  return {
    protocolVersion: '0.3.0',
    name: `Codara Agent (${config.machineName ?? os.hostname()})`,
    description: 'AI coding assistant with full development toolchain',
    url: `http://${config.host ?? 'localhost'}:${config.port}`,
    preferredTransport: 'JSONRPC',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: [
      {
        id: 'code-edit',
        name: 'Code Editing',
        description: 'Read, write, edit files with full development tools',
        tags: ['development', 'coding'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Review code changes for quality, correctness, and style',
        tags: ['review', 'quality'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
      {
        id: 'testing',
        name: 'Test Execution',
        description: 'Write and run tests, report results',
        tags: ['testing', 'quality'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
  };
}

// ─── A2A Server ─────────────────────────────────────────────────────

/** Lightweight A2A server using Bun's native HTTP. */
export class CodaraA2AServer {
  private agentCard: AgentCard;

  constructor(private config: A2AServerConfig) {
    this.agentCard = buildCodaraAgentCard(config);
  }

  getAgentCard(): AgentCard {
    return this.agentCard;
  }

  /** Handle an incoming HTTP request. */
  handleRequest(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);

    // Agent card discovery
    if (req.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
      return Response.json(this.agentCard);
    }

    // JSON-RPC endpoint
    if (req.method === 'POST' && url.pathname === '/') {
      return this.handleJsonRpc(req);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleJsonRpc(req: Request): Promise<Response> {
    try {
      const body = await req.json();

      // Basic JSON-RPC validation
      if (!body.jsonrpc || body.jsonrpc !== '2.0' || !body.method) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: body.id ?? null,
            error: { code: -32600, message: 'Invalid Request' },
          },
          { status: 400 },
        );
      }

      // Route methods
      switch (body.method) {
        case 'message/send':
          return this.handleMessageSend(body);
        case 'tasks/get':
          return this.handleTasksGet(body);
        case 'tasks/cancel':
          return this.handleTasksCancel(body);
        default:
          return Response.json(
            {
              jsonrpc: '2.0',
              id: body.id ?? null,
              error: { code: -32601, message: `Method not found: ${body.method}` },
            },
            { status: 404 },
          );
      }
    } catch {
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        { status: 400 },
      );
    }
  }

  private handleMessageSend(body: any): Response {
    const taskId = `task-${Date.now()}`;
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        id: taskId,
        status: { state: 'submitted' },
        contextId: taskId,
      },
    });
  }

  private handleTasksGet(body: any): Response {
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { id: body.params?.id, status: { state: 'unknown' } },
    });
  }

  private handleTasksCancel(body: any): Response {
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { id: body.params?.id, status: { state: 'canceled' } },
    });
  }
}
