import { computerRoutes } from './computer-routes.js';
import { connectionRoutes } from './connection-routes.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { configured, type Config } from './research.js';
import type { Platform } from './platform.js';
import { VoiceService } from './voice.js';
import { workspaceRoutes } from './workspace-routes.js';
const interval = z.number().int().min(60).max(31_536_000).nullable();
export interface AppOptions {
  store: Store;
  runner: Runner;
  config: Config;
  ownerToken?: string;
  ownerPasswordHash?: string;
  authenticateOwner?: (password: string) => Promise<boolean>;
  origin?: string | string[];
  platform?: Platform;
}
export function createApp({
  store,
  runner,
  config,
  ownerToken,
  ownerPasswordHash,
  authenticateOwner,
  origin,
  platform,
}: AppOptions) {
  const app = new Hono();
  const managerUrl = (process.env.HARNESS_MANAGER_URL || '').replace(/\/$/, '');
  const managerToken = process.env.HARNESS_MANAGER_TOKEN || '';
  const sessions = new Map<string, number>();
  const sessionCookie = 'opendots_session';
  const sessionLifetimeSeconds = 12 * 60 * 60;
  const sessionFromRequest = (request: Request) => {
    const cookie = request.headers.get('cookie');
    const value = cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookie}=`))
      ?.slice(sessionCookie.length + 1);
    if (!value) return undefined;
    const expiresAt = sessions.get(value);
    if (!expiresAt) return undefined;
    if (expiresAt <= Date.now()) {
      sessions.delete(value);
      return undefined;
    }
    return value;
  };
  const requestHarnessManager = async <T extends Record<string, unknown>>(
    path: string,
    body?: unknown,
    timeoutMs = 35_000,
  ): Promise<T> => {
    if (!managerUrl || !managerToken)
      throw new Error('Host harness service is not configured.');
    const response = await fetch(`${managerUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(
        result.error ||
          `Host harness service returned HTTP ${response.status}.`,
      );
    return result;
  };
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 1_000_000,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  );
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const requestUrl = new URL(c.req.url);
    const origins = origin
      ? Array.isArray(origin)
        ? origin
        : [origin]
      : undefined;
    const originHostnames = origins
      ? origins
          .map((o) => {
            try {
              return new URL(o).hostname;
            } catch {
              return '';
            }
          })
          .filter(Boolean)
      : [];
    const allowedHosts = new Set([
      'localhost',
      '127.0.0.1',
      '[::1]',
      ...originHostnames,
    ]);
    if (
      !ownerToken &&
      !ownerPasswordHash &&
      !allowedHosts.has(requestUrl.hostname)
    )
      return c.json({ error: 'Unrecognized host.' }, 403);
    const requestOrigin = c.req.header('origin');
    const allowedOrigins = new Set(origins ?? [new URL(c.req.url).origin]);
    if (requestOrigin && !allowedOrigins.has(requestOrigin))
      return c.json({ error: 'Cross-origin requests are not allowed.' }, 403);
    if (c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ error: 'Cross-site requests are not allowed.' }, 403);
    const path = requestUrl.pathname;
    const authEndpoint = [
      '/api/auth/login',
      '/api/auth/status',
      '/api/auth/logout',
    ].includes(path);
    if (ownerPasswordHash && !authEndpoint) {
      const session = sessionFromRequest(c.req.raw);
      const bearer = c.req.header('authorization')?.replace(/^Bearer /, '');
      const tokenAccepted =
        path.startsWith('/api/copilotkit') &&
        !!ownerToken &&
        !!bearer &&
        (() => {
          const expected = Buffer.from(ownerToken);
          const supplied = Buffer.from(bearer);
          return (
            expected.length === supplied.length &&
            timingSafeEqual(expected, supplied)
          );
        })();
      if (!session && !tokenAccepted)
        return c.json(
          {
            error: ownerPasswordHash
              ? 'Enter your ACTUALLY Open Dots password to unlock ACTUALLY Open Dots.'
              : 'Enter your owner access token to unlock ACTUALLY Open Dots.',
          },
          401,
        );
    } else if (ownerToken && !ownerPasswordHash && !authEndpoint) {
      const expected = Buffer.from(ownerToken);
      const supplied = Buffer.from(
        c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
      );
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        return c.json(
          {
            error:
              'Enter your owner access token to unlock ACTUALLY Open Dots.',
          },
          401,
        );
    }
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      !c.req.header('content-type')?.includes('application/json')
    )
      return c.json({ error: 'Use application/json.' }, 415);
    await next();
  });
  app.get('/api/auth/status', (c) =>
    c.json({
      authenticated: !!sessionFromRequest(c.req.raw),
      passwordConfigured: !!ownerPasswordHash,
    }),
  );
  app.post('/api/auth/login', async (c) => {
    if (!ownerPasswordHash || !authenticateOwner)
      return c.json({ error: 'Password login is not configured.' }, 503);
    const body = z
      .object({ password: z.string().min(1).max(1024) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: 'Enter your ACTUALLY Open Dots password.' }, 400);
    const accepted = await authenticateOwner(body.data.password);
    if (!accepted)
      return c.json(
        { error: 'That ACTUALLY Open Dots password was not accepted.' },
        401,
      );
    const session = randomBytes(32).toString('hex');
    sessions.set(session, Date.now() + sessionLifetimeSeconds * 1000);
    const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
    c.header(
      'Set-Cookie',
      `${sessionCookie}=${session}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionLifetimeSeconds}${secure}`,
    );
    return c.json({ authenticated: true });
  });
  app.post('/api/auth/logout', (c) => {
    const session = sessionFromRequest(c.req.raw);
    if (session) sessions.delete(session);
    c.header(
      'Set-Cookie',
      `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`,
    );
    return c.json({ authenticated: false });
  });
  if (platform) app.route('/api', computerRoutes(platform.computers));
  if (platform)
    app.route(
      '/api',
      connectionRoutes(platform.workspace, platform.connections),
    );
  const voice = platform ? new VoiceService(platform) : undefined;
  if (platform && voice) app.route('/api', workspaceRoutes(platform, voice));
  app.get('/api/state', (c) =>
    c.json({
      settings: store.settings(),
      tasks: store.tasks(),
      memories: store.memories(),
      mode: config.mode,
      configured: configured(config),
    }),
  );
  app.post('/api/tasks', async (c) => {
    const parsed = z
      .object({
        prompt: z.string().trim().min(3).max(4000),
        intervalSeconds: interval.optional(),
        threadId: z.string().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error:
            'Enter a request between 3 and 4,000 characters; repeat intervals must be at least 60 seconds.',
        },
        400,
      );
    if (!store.settings().researchAllowed)
      return c.json({ error: 'Research is disabled in Settings.' }, 403);
    if (platform) {
      if (platform.setup().missing.length)
        return c.json(
          { error: `Setup required: ${platform.setup().missing.join(', ')}.` },
          503,
        );
      if (!parsed.data.threadId)
        return c.json(
          { error: 'Select a conversation for this scheduled task.' },
          400,
        );
      try {
        platform.workspace.requireThread(parsed.data.threadId);
      } catch {
        return c.json(
          { error: 'Conversation is not owned by this workspace.' },
          403,
        );
      }
    }
    const task = store.createTask(
      parsed.data.prompt,
      parsed.data.intervalSeconds,
    );
    if (platform && parsed.data.threadId)
      platform.workspace.bindTask(task.id, parsed.data.threadId);
    return c.json(task, 201);
  });
  app.get('/api/tasks/:id', (c) => {
    const detail = store.detail(c.req.param('id'));
    return detail ? c.json(detail) : c.json({ error: 'Task not found.' }, 404);
  });
  app.post('/api/tasks/:id/actions', async (c) => {
    const parsed = z
      .object({ action: z.enum(['run', 'pause', 'cancel']) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Unknown task action.' }, 400);
    if (parsed.data.action === 'run' && !store.settings().researchAllowed)
      return c.json({ error: 'Research is disabled in Settings.' }, 403);
    const task = store.action(c.req.param('id'), parsed.data.action);
    if (parsed.data.action !== 'run') runner.abort(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });
  app.put('/api/tasks/:id/schedule', async (c) => {
    const parsed = z
      .object({ intervalSeconds: interval })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Repeat interval must be 60 seconds to one year, or null.' },
        400,
      );
    const task = store.schedule(c.req.param('id'), parsed.data.intervalSeconds);
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });
  app.patch('/api/settings', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        paused: z.boolean().optional(),
        researchAllowed: z.boolean().optional(),
        memoryAllowed: z.boolean().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid settings.' }, 400);
    const previous = store.settings();
    const settings = store.updateSettings(parsed.data);
    if (
      settings.paused ||
      !settings.researchAllowed ||
      previous.memoryAllowed !== settings.memoryAllowed
    )
      runner.abortAll();
    if (settings.paused) voice?.abortAll();
    else void voice?.resumePending();
    return c.json(settings);
  });
  app.get('/api/provider-settings', async (c) => {
    let current = platform?.store.providerConfig({
      kind: 'omniroute',
      baseUrl: platform.config.baseUrl,
      model: platform.config.model ?? '',
      apiKey: platform.config.apiKey,
      voiceModel: platform.config.voiceModel,
      voiceKey: platform.config.voiceKey,
      voiceName: platform.config.voiceName,
    }) ?? { kind: 'custom' as const, baseUrl: '', model: '' };
    if (platform && !current.connections?.length) {
      const residentId = 'connection-resident';
      const connections = current.baseUrl
        ? [
            {
              id: residentId,
              name:
                current.kind === 'omniroute'
                  ? 'OmniRoute'
                  : 'Resident endpoint',
              kind: current.kind === 'opencode' ? 'custom' : current.kind,
              baseUrl: current.baseUrl,
              model: current.model,
              apiKey: current.apiKey,
            },
          ]
        : [];
      const housekeepingId = current.housekeepingBaseUrl
        ? 'connection-housekeeping'
        : residentId;
      if (current.housekeepingBaseUrl)
        connections.push({
          id: housekeepingId,
          name: 'Housekeeping endpoint',
          kind:
            current.housekeepingKind ??
            (current.kind === 'opencode' ? 'custom' : current.kind),
          baseUrl: current.housekeepingBaseUrl,
          model: current.housekeepingModel ?? '',
          apiKey: current.housekeepingApiKey,
        });
      current = platform.store.updateProviderConfig({
        connections,
        residentConnectionId: connections.length ? residentId : undefined,
        housekeepingConnectionId: connections.length
          ? housekeepingId
          : undefined,
      });
    }
    if (platform && current.connections?.length) {
      try {
        const credentials = await requestHarnessManager<{
          hermesKey?: string;
        }>('/credentials', undefined, 8_000);
        const configured = current.connections.map((connection) =>
          connection.kind === 'hermes' &&
          !connection.apiKey &&
          connection.baseUrl ===
            (process.env.HERMES_PUBLIC_URL || 'http://127.0.0.1:8642/v1') &&
          credentials.hermesKey
            ? { ...connection, apiKey: credentials.hermesKey }
            : connection,
        );
        if (
          configured.some(
            (connection, index) =>
              connection.apiKey !== current.connections?.[index]?.apiKey,
          )
        )
          current = platform.store.updateProviderConfig({
            connections: configured,
          });
      } catch {
        // A custom or not-yet-installed Hermes connection remains editable.
      }
    }
    return c.json({
      kind: current.kind,
      baseUrl: current.baseUrl,
      model: current.model,
      hasApiKey: !!current.apiKey,
      voiceModel: current.voiceModel ?? '',
      hasVoiceKey: !!current.voiceKey,
      voiceName: current.voiceName ?? 'marin',
      voiceBaseUrl: current.voiceBaseUrl ?? '',
      openCodeUrl: current.openCodeUrl ?? '',
      hasOpenCodePassword: !!current.openCodePassword,
      housekeepingKind: current.housekeepingKind ?? 'omniroute',
      housekeepingBaseUrl: current.housekeepingBaseUrl ?? '',
      housekeepingModel: current.housekeepingModel ?? '',
      hasHousekeepingApiKey: !!current.housekeepingApiKey,
      residentConnectionId:
        current.residentConnectionId ?? current.connections?.[0]?.id ?? '',
      housekeepingConnectionId:
        current.housekeepingConnectionId ?? current.residentConnectionId ?? '',
      connections: (current.connections ?? []).map(
        ({ apiKey, ...connection }) => ({
          ...connection,
          hasApiKey: !!apiKey,
          apiKey: '',
        }),
      ),
    });
  });
  app.patch('/api/provider-settings', async (c) => {
    if (!platform)
      return c.json({ error: 'Live model configuration is unavailable.' }, 503);
    const parsed = z
      .object({
        kind: z
          .enum([
            'omniroute',
            'openai',
            'grok',
            'gemini',
            'hermes',
            'opencode',
            'custom',
          ])
          .optional(),
        baseUrl: z.string().trim().max(2048).optional(),
        model: z.string().trim().max(256).optional(),
        apiKey: z.string().max(4096).optional(),
        voiceModel: z.string().trim().max(256).optional(),
        voiceKey: z.string().max(4096).optional(),
        voiceName: z.string().trim().max(64).optional(),
        voiceBaseUrl: z.string().trim().max(2048).optional(),
        openCodeUrl: z.string().trim().max(2048).optional(),
        openCodePassword: z.string().max(4096).optional(),
        housekeepingKind: z
          .enum(['omniroute', 'openai', 'grok', 'gemini', 'hermes', 'custom'])
          .optional(),
        housekeepingBaseUrl: z.string().trim().max(2048).optional(),
        housekeepingModel: z.string().trim().max(256).optional(),
        housekeepingApiKey: z.string().max(4096).optional(),
        residentConnectionId: z.string().trim().max(80).optional(),
        housekeepingConnectionId: z.string().trim().max(80).optional(),
        connections: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(80),
              name: z.string().trim().min(1).max(80),
              kind: z.enum([
                'omniroute',
                'openai',
                'grok',
                'gemini',
                'hermes',
                'custom',
              ]),
              baseUrl: z.string().trim().min(1).max(2048),
              model: z.string().trim().max(256),
              apiKey: z.string().max(4096).optional(),
              hasApiKey: z.boolean().optional(),
            }),
          )
          .max(32)
          .optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Invalid provider settings.' }, 400);
    if (parsed.data.baseUrl && !/^https?:\/\//i.test(parsed.data.baseUrl))
      return c.json({ error: 'Use an http:// or https:// endpoint URL.' }, 400);
    if (
      parsed.data.voiceBaseUrl &&
      !/^https?:\/\//i.test(parsed.data.voiceBaseUrl)
    )
      return c.json(
        { error: 'Use an http:// or https:// voice endpoint URL.' },
        400,
      );
    if (
      parsed.data.openCodeUrl &&
      !/^https?:\/\//i.test(parsed.data.openCodeUrl)
    )
      return c.json(
        { error: 'Use an http:// or https:// OpenCode server URL.' },
        400,
      );
    if (
      parsed.data.housekeepingBaseUrl &&
      !/^https?:\/\//i.test(parsed.data.housekeepingBaseUrl)
    )
      return c.json(
        { error: 'Use an http:// or https:// housekeeping endpoint URL.' },
        400,
      );
    for (const connection of parsed.data.connections ?? [])
      if (!/^https?:\/\//i.test(connection.baseUrl))
        return c.json(
          { error: `Use an http:// or https:// URL for ${connection.name}.` },
          400,
        );
    if (
      parsed.data.connections &&
      new Set(parsed.data.connections.map((connection) => connection.id))
        .size !== parsed.data.connections.length
    )
      return c.json({ error: 'Each saved connection needs a unique ID.' }, 400);
    if (
      parsed.data.connections &&
      [
        parsed.data.residentConnectionId,
        parsed.data.housekeepingConnectionId,
      ].some(
        (id) => id && !parsed.data.connections?.some((item) => item.id === id),
      )
    )
      return c.json(
        { error: 'Each model role must select a saved connection.' },
        400,
      );
    const providerPatch = { ...parsed.data };
    const managedHermesUrl =
      process.env.HERMES_PUBLIC_URL || 'http://127.0.0.1:8642/v1';
    if (
      providerPatch.kind === 'hermes' &&
      providerPatch.baseUrl === managedHermesUrl &&
      !providerPatch.apiKey
    ) {
      try {
        const credentials = await requestHarnessManager<{
          hermesKey?: string;
        }>('/credentials');
        if (credentials.hermesKey) providerPatch.apiKey = credentials.hermesKey;
      } catch {
        // A custom Hermes endpoint can be saved before the managed service is installed.
      }
    }
    if (
      providerPatch.housekeepingKind === 'hermes' &&
      providerPatch.housekeepingBaseUrl === managedHermesUrl &&
      !providerPatch.housekeepingApiKey
    ) {
      try {
        const credentials = await requestHarnessManager<{
          hermesKey?: string;
        }>('/credentials');
        if (credentials.hermesKey)
          providerPatch.housekeepingApiKey = credentials.hermesKey;
      } catch {
        // A custom housekeeping endpoint can be saved before the managed service is installed.
      }
    }
    const provider = platform.store.updateProviderConfig(providerPatch, {
      kind: 'omniroute',
      baseUrl: platform.config.baseUrl,
      model: platform.config.model ?? '',
      apiKey: platform.config.apiKey,
      voiceModel: platform.config.voiceModel,
      voiceKey: platform.config.voiceKey,
      voiceName: platform.config.voiceName,
    });
    try {
      await requestHarnessManager('/configure', provider);
    } catch {
      // Host harnesses can be installed later; provider settings remain usable without them.
    }
    return c.json({
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      model: provider.model,
      hasApiKey: !!provider.apiKey,
      voiceModel: provider.voiceModel ?? '',
      hasVoiceKey: !!provider.voiceKey,
      voiceName: provider.voiceName ?? 'marin',
      voiceBaseUrl: provider.voiceBaseUrl ?? '',
      openCodeUrl: provider.openCodeUrl ?? '',
      hasOpenCodePassword: !!provider.openCodePassword,
      housekeepingKind: provider.housekeepingKind ?? 'omniroute',
      housekeepingBaseUrl: provider.housekeepingBaseUrl ?? '',
      housekeepingModel: provider.housekeepingModel ?? '',
      hasHousekeepingApiKey: !!provider.housekeepingApiKey,
      residentConnectionId: provider.residentConnectionId ?? '',
      housekeepingConnectionId: provider.housekeepingConnectionId ?? '',
      connections: (provider.connections ?? []).map(
        ({ apiKey, ...connection }) => ({
          ...connection,
          hasApiKey: !!apiKey,
          apiKey: '',
        }),
      ),
    });
  });
  app.post('/api/provider-settings/test', async (c) => {
    if (!platform)
      return c.json({ error: 'Live model configuration is unavailable.' }, 503);
    const request = z
      .object({
        target: z
          .enum([
            'chat',
            'connection',
            'model',
            'housekeeping',
            'voice',
            'opencode',
          ])
          .default('chat'),
        connectionId: z.string().optional(),
        model: z.string().trim().max(256).optional(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        openCodeUrl: z.string().optional(),
        openCodePassword: z.string().optional(),
        housekeepingBaseUrl: z.string().optional(),
        housekeepingApiKey: z.string().optional(),
        voiceBaseUrl: z.string().optional(),
        voiceKey: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!request.success) return c.json({ error: 'Invalid test target.' }, 400);
    const provider = platform.store.providerConfig({
      kind: 'omniroute',
      baseUrl: platform.config.baseUrl,
      model: platform.config.model ?? '',
      apiKey: platform.config.apiKey,
    });
    const selectedConnection = provider.connections?.find(
      (item) => item.id === request.data.connectionId,
    );
    const url =
      request.data.target === 'opencode'
        ? (request.data.openCodeUrl ?? provider.openCodeUrl)
        : request.data.target === 'connection' ||
            request.data.target === 'model'
          ? (selectedConnection?.baseUrl ?? '')
          : request.data.target === 'housekeeping'
            ? (request.data.housekeepingBaseUrl ?? provider.housekeepingBaseUrl)
            : request.data.target === 'voice'
              ? (request.data.voiceBaseUrl ?? provider.voiceBaseUrl)
              : (request.data.baseUrl ?? provider.baseUrl);
    const authKey =
      request.data.target === 'opencode'
        ? request.data.openCodePassword?.trim() || provider.openCodePassword
        : request.data.target === 'connection' ||
            request.data.target === 'model'
          ? request.data.apiKey?.trim() || selectedConnection?.apiKey
          : request.data.target === 'housekeeping'
            ? request.data.housekeepingApiKey?.trim() ||
              provider.housekeepingApiKey ||
              provider.apiKey
            : request.data.target === 'voice'
              ? request.data.voiceKey?.trim() || provider.voiceKey
              : request.data.apiKey?.trim() || provider.apiKey;
    if (!url) return c.json({ error: 'Enter an endpoint URL first.' }, 400);
    const resolvedAuthKey = authKey;
    try {
      const base = url.replace(/\/$/, '');
      const isModelTest = request.data.target === 'model';
      const response = await fetch(
        request.data.target === 'opencode'
          ? `${base}/global/health`
          : isModelTest
            ? `${base}/chat/completions`
            : `${base}/models`,
        {
          method: isModelTest ? 'POST' : 'GET',
          headers:
            request.data.target === 'opencode' && resolvedAuthKey
              ? {
                  Authorization: `Basic ${Buffer.from(`opencode:${resolvedAuthKey}`).toString('base64')}`,
                }
              : {
                  ...(resolvedAuthKey
                    ? { Authorization: `Bearer ${resolvedAuthKey}` }
                    : {}),
                  ...(isModelTest
                    ? { 'Content-Type': 'application/json' }
                    : {}),
                },
          ...(isModelTest
            ? {
                body: JSON.stringify({
                  model: request.data.model || selectedConnection?.model,
                  messages: [{ role: 'user', content: 'Reply with only: OK' }],
                  max_tokens: 16,
                  stream: false,
                }),
              }
            : {}),
          signal: AbortSignal.timeout(isModelTest ? 120_000 : 30_000),
        },
      );
      if (!response.ok)
        return c.json(
          { error: `Endpoint returned HTTP ${response.status}.` },
          502,
        );
      const data = (await response.json().catch(() => null)) as {
        data?: { id?: unknown }[];
        healthy?: boolean;
        choices?: { message?: { content?: unknown } }[];
      } | null;
      if (isModelTest) {
        const content = data?.choices?.[0]?.message?.content;
        return c.json({
          ok: true,
          detail:
            typeof content === 'string' && content.trim()
              ? `Model replied: ${content.trim().slice(0, 200)}`
              : 'The endpoint answered the model request.',
        });
      }
      const models = Array.isArray(data?.data)
        ? data.data
            .map((entry) => entry.id)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return c.json({
        ok: true,
        models,
        detail:
          request.data.target === 'opencode'
            ? 'OpenCode server is reachable.'
            : Array.isArray(data?.data)
              ? `Connected; ${data.data.length} model(s) listed.`
              : 'Endpoint is reachable.',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError')
        return c.json(
          {
            error:
              request.data.target === 'model'
                ? 'The model took over 120 seconds to answer. Check OmniRoute and its backend model; increase MODEL_TURN_TIMEOUT_MS if normal local inference takes longer.'
                : 'The endpoint took over 30 seconds to answer its check. Verify the OmniRoute host and model provider are running, then try again.',
          },
          504,
        );
      return c.json(
        {
          error:
            'Could not reach the configured endpoint. Check its URL, network access, and authentication.',
        },
        502,
      );
    }
  });
  app.get('/api/local-harnesses', async (c) => {
    try {
      const status = await requestHarnessManager<Record<string, unknown>>(
        '/status',
        undefined,
        8_000,
      );
      const credentials = await requestHarnessManager<{
        hermesKey?: string;
        openCodePassword?: string;
      }>('/credentials', undefined, 8_000);
      const current = store.providerConfig();
      const hermesUrl =
        process.env.HERMES_PUBLIC_URL || 'http://127.0.0.1:8642/v1';
      const openCodeUrl =
        process.env.OPENCODE_PUBLIC_URL || 'http://127.0.0.1:4096';
      const patch: Record<string, string> = {};
      if (
        !current.openCodeUrl &&
        (status.opencode as { installed?: boolean } | undefined)?.installed
      ) {
        patch.openCodeUrl = openCodeUrl;
        if (credentials.openCodePassword)
          patch.openCodePassword = credentials.openCodePassword;
      }
      if (
        current.kind === 'hermes' &&
        current.baseUrl === hermesUrl &&
        !current.apiKey &&
        credentials.hermesKey
      )
        patch.apiKey = credentials.hermesKey;
      if (Object.keys(patch).length) store.updateProviderConfig(patch);
      return c.json(status);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Harness manager unavailable.',
        },
        503,
      );
    }
  });
  app.post('/api/local-harnesses/install', async (c) => {
    const parsed = z
      .object({
        harness: z.enum(['hermes', 'opencode', 'gemini', 'codex', 'grok']),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Unknown local harness.' }, 400);
    let result: { accepted: boolean; error?: string };
    try {
      result = await requestHarnessManager('/install', {
        harness: parsed.data.harness,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Harness manager unavailable.',
        },
        503,
      );
    }
    return c.json(result, result.accepted ? 202 : 409);
  });
  app.post('/api/local-harnesses/start', async (c) => {
    const parsed = z
      .object({
        harness: z.enum(['hermes', 'opencode', 'gemini', 'codex', 'grok']),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Unknown local harness.' }, 400);
    let result: { accepted: boolean; error?: string };
    try {
      result = await requestHarnessManager('/start', {
        harness: parsed.data.harness,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Harness manager unavailable.',
        },
        503,
      );
    }
    return c.json(result, result.accepted ? 200 : 404);
  });
  app.post('/api/local-harnesses/login', async (c) => {
    const parsed = z
      .object({ harness: z.enum(['codex', 'grok']) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Device sign-in is unavailable for this harness.' },
        400,
      );
    let result: { accepted: boolean; error?: string };
    try {
      result = await requestHarnessManager('/login', {
        harness: parsed.data.harness,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Harness manager unavailable.',
        },
        503,
      );
    }
    return c.json(result, result.accepted ? 202 : 409);
  });
  app.post('/api/local-harnesses/test', async (c) => {
    const parsed = z
      .object({
        harness: z.enum(['hermes', 'opencode', 'gemini', 'codex', 'grok']),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Unknown local harness.' }, 400);
    let result: { ok: boolean; detail?: string; error?: string };
    try {
      result = await requestHarnessManager('/test', {
        harness: parsed.data.harness,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Harness manager unavailable.',
        },
        503,
      );
    }
    return c.json(result, result.ok ? 200 : 502);
  });
  app.post('/api/memories', async (c) => {
    const parsed = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Memory must be between 1 and 2,000 characters.' },
        400,
      );
    return c.json(store.saveMemory(parsed.data.text), 201);
  });
  app.put('/api/memories/:id', async (c) => {
    const parsed = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Memory must be between 1 and 2,000 characters.' },
        400,
      );
    if (!store.memories().some((m) => m.id === c.req.param('id')))
      return c.json({ error: 'Memory not found.' }, 404);
    return c.json(store.saveMemory(parsed.data.text, c.req.param('id')));
  });
  app.delete('/api/memories/:id', (c) =>
    store.deleteMemory(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'Memory not found.' }, 404),
  );
  app.onError((error, c) => {
    console.error('API request failed:', error.name);
    return c.json(
      {
        error:
          'The server could not complete this request. Check server logs and database access.',
      },
      500,
    );
  });
  return app;
}
