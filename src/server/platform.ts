import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotRuntime,
  type CopilotRuntimeLike,
  AgentRunner,
  createCopilotHonoHandler,
  type CopilotHonoApp,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  type AgentRunnerIsRunningRequest,
  type LocalThreadEndpointRecord,
} from '@copilotkit/runtime/v2';
import type { Message, BaseEvent } from '@ag-ui/client';
import { Observable } from 'rxjs';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import { setupStatus, type PlatformConfig } from './platform-config.js';
import { providerForTurn } from './model-role.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { InMemoryAgentRunner } from '@copilotkit/runtime/v2';

/** Local SSE runner with durable conversation snapshots in ACTUALLY Open Dots' SQLite DB. */
class SQLiteAgentRunner extends AgentRunner {
  private readonly memory = new InMemoryAgentRunner({
    maxThreads: Infinity,
    maxRunsPerThread: Infinity,
    maxBytes: Infinity,
  });
  constructor(private workspace: WorkspaceStore) {
    super();
  }
  run(request: AgentRunnerRunRequest) {
    return new Observable<BaseEvent>((subscriber) => {
      const persisted = this.workspace.threadMessages(request.threadId);
      const incoming = request.input.messages ?? [];
      const seen = new Set(persisted.map((message) => message.id));
      const messages = [
        ...persisted,
        ...incoming.filter((message) => !seen.has(message.id)),
      ];
      const storedEvents = this.workspace.threadEvents(request.threadId);
      const events = [...storedEvents];
      const subscription = this.memory
        .run({ ...request, input: { ...request.input, messages } })
        .subscribe({
          next: (event) => {
            events.push(event);
            subscriber.next(event);
          },
          error: (error) => subscriber.error(error),
          complete: () => {
            const snapshot = this.memory.getThreadMessages(request.threadId);
            const allMessages = [...persisted];
            const ids = new Set(allMessages.map((message) => message.id));
            for (const message of snapshot)
              if (!ids.has(message.id)) {
                allMessages.push(message);
                ids.add(message.id);
              }
            this.workspace.saveThreadSnapshot(request.threadId, allMessages, [
              ...storedEvents,
              ...events.slice(storedEvents.length),
            ]);
            subscriber.complete();
          },
        });
      return () => subscription.unsubscribe();
    });
  }
  connect(request: AgentRunnerConnectRequest) {
    const memory = this.memory.connect(request);
    const thread = this.workspace
      .conversations()
      .find(
        (item) =>
          item.id === request.threadId &&
          (!request.agentId || item.dotId === request.agentId),
      );
    if (!thread) return memory;
    const events = this.workspace.threadEvents(request.threadId);
    return new Observable<BaseEvent>((subscriber) => {
      for (const event of events) subscriber.next(event);
      const subscription = memory.subscribe({
        next: (event) => {
          if (!events.includes(event)) subscriber.next(event);
        },
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }
  isRunning(request: AgentRunnerIsRunningRequest) {
    return this.memory.isRunning(request);
  }
  stop(request: AgentRunnerStopRequest) {
    return this.memory.stop(request);
  }
  listThreads(): LocalThreadEndpointRecord[] {
    const durable = this.workspace.conversations().map((thread) => ({
      id: thread.id,
      name: thread.title,
      agentId: thread.dotId,
      organizationId: thread.ownerId,
      createdById: thread.ownerId,
      archived: false,
      createdAt: new Date(thread.createdAt).toISOString(),
      updatedAt: new Date(thread.createdAt).toISOString(),
    }));
    const byId = new Map(durable.map((thread) => [thread.id, thread]));
    for (const thread of this.memory.listThreads())
      byId.set(thread.id, {
        ...thread,
        name: thread.name ?? 'New conversation',
      });
    return [...byId.values()].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }
  getThreadMessages(threadId: string): Message[] {
    return this.workspace.conversations().some((item) => item.id === threadId)
      ? this.workspace.threadMessages(threadId)
      : [];
  }
  getThreadEvents(threadId: string): BaseEvent[] {
    return this.workspace.conversations().some((item) => item.id === threadId)
      ? this.workspace.threadEvents(threadId)
      : [];
  }
  getThreadState(threadId: string) {
    return this.memory.getThreadState(threadId);
  }
  clearThreads() {
    /* Persistent owner data is intentionally not cleared through the generic endpoint. */
  }
}
export class Platform {
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly runner: SQLiteAgentRunner;
  readonly handler?: CopilotHonoApp;
  getThreadMessages(threadId: string) {
    return this.runner.getThreadMessages(threadId);
  }
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    this.pages = new PageService(workspace, this);
    this.runner = new SQLiteAgentRunner(workspace);
    const runtime = new CopilotRuntime({
      runner: this.runner,
      agents: async () =>
        Object.fromEntries(
          workspace
            .dots()
            .map((dot) => [
              dot.id,
              new DotAgent(store, workspace, config, dot.id, false),
            ]),
        ),
    }) as unknown as CopilotRuntimeLike;
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  setup() {
    const provider = this.store.providerConfig({
      kind: 'omniroute',
      baseUrl: this.config.baseUrl,
      model: this.config.model ?? '',
      apiKey: this.config.apiKey,
      voiceModel: this.config.voiceModel,
      voiceKey: this.config.voiceKey,
      voiceName: this.config.voiceName,
    });
    const resident = providerForTurn(provider, false);
    return setupStatus({
      ...this.config,
      apiKey: resident.kind === 'opencode' ? undefined : resident.apiKey,
      model: resident.kind === 'opencode' ? undefined : resident.model,
      baseUrl: resident.baseUrl,
      voiceKey: provider.voiceKey ?? this.config.voiceKey,
      voiceModel: provider.voiceModel ?? this.config.voiceModel,
    });
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Setup required: ${missing.join(', ')}. Local conversations require model configuration.`,
      );
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    return this.workspace
      .threadMessages(threadId)
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map((part) => (typeof part === 'string' ? part : 'text' in part && typeof part.text === 'string' ? part.text : '')).join(' ') : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request): Promise<Response> {
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    const url = new URL(request.url);
    if (/\/threads\/subscribe(?:\/|$)/.test(url.pathname))
      return Response.json({ joinToken: '', joinCode: null });
    const threadMatch = url.pathname.match(
      /\/threads\/([^/]+)(?:\/(messages|events|state|archive))?$/,
    );
    if (threadMatch) {
      try {
        this.workspace.requireThread(decodeURIComponent(threadMatch[1]));
      } catch {
        return Response.json(
          { error: 'Conversation not found.' },
          { status: 404 },
        );
      }
    }
    if (url.pathname.endsWith('/threads') && request.method === 'GET') {
      const agentId = url.searchParams.get('agentId');
      const threads = this.workspace
        .conversations()
        .filter((thread) => !agentId || thread.dotId === agentId)
        .map((thread) => ({
          id: thread.id,
          name: thread.title,
          agentId: thread.dotId,
          organizationId: this.workspace.ownerId,
          createdById: this.workspace.ownerId,
          archived: false,
          createdAt: new Date(thread.createdAt).toISOString(),
          updatedAt: new Date(thread.createdAt).toISOString(),
        }));
      return Response.json({ threads, nextCursor: null });
    }
    const match = url.pathname.match(/\/threads\/([^/]+)\/(messages|events)$/);
    if (match && request.method === 'GET') {
      const threadId = decodeURIComponent(match[1]);
      try {
        return match[2] === 'messages'
          ? Response.json({ messages: this.workspace.threadMessages(threadId) })
          : Response.json({ events: this.workspace.threadEvents(threadId) });
      } catch {
        return Response.json(
          { error: 'Conversation not found.' },
          { status: 404 },
        );
      }
    }
    if (url.pathname.endsWith('/threads') && request.method !== 'GET')
      return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    if (threadMatch && /\/(archive|state)$/.test(url.pathname))
      return Response.json(
        { error: 'This local operation is not supported.' },
        { status: 501 },
      );
    return this.handler!.fetch(request);
  }
  persistRuntimeHistory() {
    for (const thread of this.workspace.conversations()) {
      const messages = this.runner.getThreadMessages(thread.id);
      if (messages.length)
        this.workspace.saveThreadSnapshot(
          thread.id,
          messages,
          this.runner.getThreadEvents(thread.id),
        );
    }
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    return runThreadTurn(
      this.config.runtimeUrl,
      this.config.ownerToken
        ? { Authorization: `Bearer ${this.config.ownerToken}` }
        : {},
      thread.dotId,
      threadId,
      prompt,
      signal,
      metadata,
    );
  }
}
