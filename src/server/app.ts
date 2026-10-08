import { computerRoutes } from './computer-routes.js';
import { connectionRoutes } from './connection-routes.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
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
  origin?: string | string[];
  platform?: Platform;
}
export function createApp({
  store,
  runner,
  config,
  ownerToken,
  origin,
  platform,
}: AppOptions) {
  const app = new Hono();
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
    if (!ownerToken && !allowedHosts.has(requestUrl.hostname))
      return c.json({ error: 'Unrecognized host.' }, 403);
    const requestOrigin = c.req.header('origin');
    const allowedOrigins = new Set(origins ?? [new URL(c.req.url).origin]);
    if (requestOrigin && !allowedOrigins.has(requestOrigin))
      return c.json({ error: 'Cross-origin requests are not allowed.' }, 403);
    if (c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ error: 'Cross-site requests are not allowed.' }, 403);
    if (ownerToken) {
      const expected = Buffer.from(ownerToken);
      const supplied = Buffer.from(
        c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
      );
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        return c.json(
          { error: 'Enter your owner access token to unlock OpenDots.' },
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
  app.get('/api/provider-settings', (c) => {
    const current = platform?.store.providerConfig({
      kind: 'omniroute',
      baseUrl: platform.config.baseUrl,
      model: platform.config.model ?? '',
      apiKey: platform.config.apiKey,
      voiceModel: platform.config.voiceModel,
      voiceKey: platform.config.voiceKey,
      voiceName: platform.config.voiceName,
    }) ?? { kind: 'custom' as const, baseUrl: '', model: '' };
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
    });
  });
  app.patch('/api/provider-settings', async (c) => {
    if (!platform)
      return c.json({ error: 'Live model configuration is unavailable.' }, 503);
    const parsed = z
      .object({
        kind: z.enum(['omniroute', 'hermes', 'opencode', 'custom']).optional(),
        baseUrl: z.string().trim().max(2048).optional(),
        model: z.string().trim().max(256).optional(),
        apiKey: z.string().max(4096).optional(),
        voiceModel: z.string().trim().max(256).optional(),
        voiceKey: z.string().max(4096).optional(),
        voiceName: z.string().trim().max(64).optional(),
        voiceBaseUrl: z.string().trim().max(2048).optional(),
        openCodeUrl: z.string().trim().max(2048).optional(),
        openCodePassword: z.string().max(4096).optional(),
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
    const provider = platform.store.updateProviderConfig(parsed.data, {
      kind: 'omniroute',
      baseUrl: platform.config.baseUrl,
      model: platform.config.model ?? '',
      apiKey: platform.config.apiKey,
      voiceModel: platform.config.voiceModel,
      voiceKey: platform.config.voiceKey,
      voiceName: platform.config.voiceName,
    });
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
    });
  });
  app.post('/api/provider-settings/test', async (c) => {
    if (!platform)
      return c.json({ error: 'Live model configuration is unavailable.' }, 503);
    const request = z
      .object({
        target: z.enum(['chat', 'opencode']).default('chat'),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        openCodeUrl: z.string().optional(),
        openCodePassword: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!request.success) return c.json({ error: 'Invalid test target.' }, 400);
    const provider = platform.store.providerConfig({
      kind: 'omniroute',
      baseUrl: platform.config.baseUrl,
      model: platform.config.model ?? '',
      apiKey: platform.config.apiKey,
    });
    const url =
      request.data.target === 'opencode'
        ? (request.data.openCodeUrl ?? provider.openCodeUrl)
        : (request.data.baseUrl ?? provider.baseUrl);
    const authKey =
      request.data.target === 'opencode'
        ? (request.data.openCodePassword ?? provider.openCodePassword)
        : (request.data.apiKey ?? provider.apiKey);
    if (!url) return c.json({ error: 'Enter an endpoint URL first.' }, 400);
    try {
      const base = url.replace(/\/$/, '');
      const response = await fetch(
        request.data.target === 'opencode'
          ? `${base}/global/health`
          : `${base}/models`,
        {
          headers:
            request.data.target === 'opencode' && authKey
              ? {
                  Authorization: `Basic ${Buffer.from(`opencode:${authKey}`).toString('base64')}`,
                }
              : authKey
                ? { Authorization: `Bearer ${authKey}` }
                : {},
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok)
        return c.json(
          { error: `Endpoint returned HTTP ${response.status}.` },
          502,
        );
      const data = (await response.json().catch(() => null)) as {
        data?: unknown[];
        healthy?: boolean;
      } | null;
      return c.json({
        ok: true,
        detail:
          request.data.target === 'opencode'
            ? 'OpenCode server is reachable.'
            : Array.isArray(data?.data)
              ? `Connected; ${data.data.length} model(s) listed.`
              : 'Endpoint is reachable.',
      });
    } catch {
      return c.json(
        {
          error:
            'Could not reach the configured endpoint. Check its URL, network access, and authentication.',
        },
        502,
      );
    }
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
