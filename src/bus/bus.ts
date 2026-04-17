import {randomUUID} from 'node:crypto';
import {createCodaraRuntime} from '../codara/facade';
import type {Codara} from '../codara/facade';
import type {CodaraRuntimeEvent} from '@events';
import type {AgentStreamOutput} from '@core/agent';
import {TypedEmitter} from './event-emitter';
import {classifyAndEmit} from './bus-classify';
import type {BusClientInfo, BusConfig, BusEvent, BusRequest, ClientId} from './types';

/**
 * CodaraBus — the single runtime owner that all clients connect to.
 *
 * Responsibilities:
 * - Owns the Codara runtime lifecycle (init / dispose)
 * - Registers and tracks connected clients
 * - Routes requests to the runtime and emits typed events
 * - Event filtering is the caller's responsibility (server layer)
 *
 * All events are emitted through a single TypedEmitter. The server layer
 * filters per-client based on session subscriptions and requestIds.
 */
export class CodaraBus {
  private runtime: Codara | null = null;
  private clients = new Map<ClientId, BusClientInfo>();
  private events = new TypedEmitter<BusEvent>();
  private runtimeUnsubscribe?: () => void;
  private config: BusConfig;

  constructor(config: BusConfig = {}) {
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Initialize the runtime. Must be called before handling requests. */
  async init(): Promise<void> {
    if (this.runtime) {
      return;
    }

    this.runtime = await createCodaraRuntime({
      cwd: this.config.cwd,
    });

    // Forward all runtime events as BusEvents.
    this.runtimeUnsubscribe = this.runtime.subscribeRuntimeEvents(
      (event: CodaraRuntimeEvent) => {
        this.events.emit({
          type: 'runtime_event',
          sessionId: event.sessionId,
          kind: event.kind,
          phase: event.phase,
          status: event.status,
          label: event.label,
          detail: event.detail,
        });
      },
    );
  }

  /** Graceful shutdown. */
  async dispose(): Promise<void> {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;

    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = null;
    }

    this.events.clear();
    this.clients.clear();
  }

  // ── Client Management ──────────────────────────────────────────────

  /** Register a new client. Returns its generated ID. */
  registerClient(info: Omit<BusClientInfo, 'id' | 'connectedAt' | 'subscriptions'>): ClientId {
    const id = randomUUID();
    const client: BusClientInfo = {
      ...info,
      id,
      connectedAt: Date.now(),
      subscriptions: new Set(),
    };
    this.clients.set(id, client);

    this.events.emit({
      type: 'client.joined',
      clientId: id,
      metadata: {name: info.name, clientType: info.type},
    });

    return id;
  }

  /** Unregister a client. */
  unregisterClient(clientId: ClientId): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    this.clients.delete(clientId);
    this.events.emit({type: 'client.left', clientId});
  }

  /** Get all connected clients. */
  getClients(): BusClientInfo[] {
    return [...this.clients.values()];
  }

  // ── Event Subscription ─────────────────────────────────────────────

  /** Subscribe to bus events. Returns an unsubscribe function. */
  subscribe(listener: (event: BusEvent) => void): () => void {
    return this.events.on(listener);
  }

  // ── Request Handling ───────────────────────────────────────────────

  /** Handle a request from a client. Never throws — errors are emitted as events. */
  async handleRequest(clientId: ClientId, request: BusRequest): Promise<void> {
    try {
      switch (request.type) {
        case 'chat':
          await this.handleChat(clientId, request);
          break;
        case 'resume':
          await this.handleResume(clientId, request);
          break;
        case 'command':
          await this.handleCommand(clientId, request);
          break;
        case 'sessions.list':
          await this.handleSessionsList(clientId, request);
          break;
        case 'sessions.create':
          await this.handleSessionsCreate(clientId, request);
          break;
        case 'subscribe':
          this.handleSubscribe(clientId, request);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, request);
          break;
        case 'status':
          await this.handleStatus(clientId, request);
          break;
        default: {
          // Exhaustive — future request types will trigger a compile error.
          const _exhaustive: never = request;
          this.events.emit({
            type: 'error',
            sessionId: 'unknown',
            requestId: 'unknown',
            message: `Unknown request type: ${(request as {type: string}).type}`,
          });
          break;
        }
      }
    } catch (error) {
      // Emit error for requests that carry a requestId.
      const requestId = 'requestId' in request ? (request as {requestId: string}).requestId : undefined;
      if (requestId) {
        const sessionId = 'sessionId' in request
          ? (request as {sessionId: string}).sessionId
          : this.runtime?.getState().sessionId ?? 'unknown';
        this.events.emit({
          type: 'error',
          sessionId,
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ── Private: Request Handlers ──────────────────────────────────────

  private requireRuntime(): Codara {
    if (!this.runtime) {
      throw new Error('Bus not initialized. Call init() first.');
    }
    return this.runtime;
  }

  private async handleChat(
    _clientId: ClientId,
    request: Extract<BusRequest, {type: 'chat'}>,
  ): Promise<void> {
    const runtime = this.requireRuntime();
    const sessionId = runtime.getState().sessionId;

    const generator = runtime.stream(request.prompt.trim(), {streamMode: 'messages'});
    await this.pipeStream(sessionId, request.requestId, runtime, generator);
  }

  private async handleResume(
    _clientId: ClientId,
    request: Extract<BusRequest, {type: 'resume'}>,
  ): Promise<void> {
    const runtime = this.requireRuntime();
    const sessionId = runtime.getState().sessionId;

    const payload: Record<string, unknown> = {decision: request.action};
    if (request.input !== undefined) {
      payload.input = request.input;
    }

    const generator = runtime.streamInteraction({
      kind: 'review',
      payload,
      config: {streamMode: 'messages'},
    });
    await this.pipeStream(sessionId, request.requestId, runtime, generator);
  }

  private async handleCommand(
    _clientId: ClientId,
    request: Extract<BusRequest, {type: 'command'}>,
  ): Promise<void> {
    const runtime = this.requireRuntime();
    const result = await runtime.executeCommand(request.command.trim());

    this.events.emit({
      type: 'command.result',
      requestId: request.requestId,
      output: result.output,
      ok: result.ok,
    });
  }

  private async handleSessionsList(
    _clientId: ClientId,
    request: Extract<BusRequest, {type: 'sessions.list'}>,
  ): Promise<void> {
    const runtime = this.requireRuntime();
    const sessions = await runtime.listSessions({
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    this.events.emit({
      type: 'sessions.list.result',
      requestId: request.requestId,
      sessions,
    });
  }

  private async handleSessionsCreate(
    _clientId: ClientId,
    request: Extract<BusRequest, {type: 'sessions.create'}>,
  ): Promise<void> {
    const runtime = this.requireRuntime();
    await runtime.reset();
    const state = runtime.getState();

    this.events.emit({
      type: 'sessions.create.result',
      requestId: request.requestId,
      sessionId: state.sessionId,
    });

    this.events.emit({
      type: 'session.updated',
      sessionId: state.sessionId,
    });
  }

  private handleSubscribe(
    clientId: ClientId,
    request: Extract<BusRequest, {type: 'subscribe'}>,
  ): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.add(request.sessionId);
    }
  }

  private handleUnsubscribe(
    clientId: ClientId,
    request: Extract<BusRequest, {type: 'unsubscribe'}>,
  ): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(request.sessionId);
    }
  }

  private async handleStatus(
    _clientId: ClientId,
    request: Extract<BusRequest, {type: 'status'}>,
  ): Promise<void> {
    const runtime = this.requireRuntime();
    const state = runtime.getState();
    const mcpStatus = runtime.getMcpStatus();

    this.events.emit({
      type: 'status.result',
      requestId: request.requestId,
      data: {
        sessionId: state.sessionId,
        status: state.sessionStatus,
        metadata: state.metadata,
        mcp: mcpStatus,
      },
    });
  }

  // ── Private: Stream Pipeline ───────────────────────────────────────

  /**
   * Pipe a Codara stream generator into BusEvents.
   *
   * Classifies each AgentStreamOutput chunk into the appropriate event type
   * and emits it through the bus. Handles AIMessageChunk text/thinking/tool_call
   * classification, custom review pause chunks, and tool result messages.
   */
  private async pipeStream(
    sessionId: string,
    requestId: string,
    _runtime: Codara,
    generator: AsyncGenerator<AgentStreamOutput, unknown, void>,
  ): Promise<void> {
    try {
      while (true) {
        const next = await generator.next();
        if (next.done) {
          const result = next.value as {
            reason?: string;
            state?: {pendingReview?: unknown};
          } | undefined;

          // Emit review_required if a blocking review is active.
          // Don't emit 'done' since the session is paused, not finished.
          if (result?.state?.pendingReview) {
            const pause = result.state.pendingReview as {
              review?: {allowedDecisions?: unknown[]};
            };
            this.events.emit({
              type: 'review_required',
              sessionId,
              requestId,
              request: result.state.pendingReview,
              actions: pause.review?.allowedDecisions ?? [],
            });
            break;
          }

          this.events.emit({type: 'done', sessionId, requestId});
          break;
        }

        classifyAndEmit((event) => this.events.emit(event), sessionId, next.value);
      }
    } catch (error) {
      this.events.emit({
        type: 'error',
        sessionId,
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
