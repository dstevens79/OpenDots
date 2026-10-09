// Local history is the product's operational record; SDK telemetry stays opt-out by default.
process.env.DO_NOT_TRACK ??= '1';
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true';
const { webSearchProvider } = await import('./parallel.js');
import { createShutdown } from './shutdown.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { createApp } from './app.js';
import { resolveAppOrigins } from './app-origin.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
import { type PlatformConfig } from './platform-config.js';
import { authenticateOwnerPassword } from './owner-auth.js';
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 4310);
const ownerToken = process.env.RUNTIME_TOKEN || process.env.OWNER_TOKEN;
const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH;
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !ownerPasswordHash)
  throw new Error(
    'External binding requires an OWNER_PASSWORD_HASH. Re-run the installer to set a password.',
  );
const database = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const store = new Store(database);
const workspace = new WorkspaceStore(
  database,
  process.env.OWNER_ID ?? 'opendots-owner',
);
const config: PlatformConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL ?? '',
  webSearchProvider: webSearchProvider(
    process.env.WEB_SEARCH_PROVIDER ?? 'disabled',
  ),
  parallelApiKey: process.env.PARALLEL_API_KEY,
  browserUrl: process.env.BROWSER_URL,
  browserSecret: process.env.BROWSER_SECRET,
  computerSupervisorUrl:
    process.env.COMPUTER_SUPERVISOR_URL?.trim() ||
    (process.env.COMPUTER_MODE === 'local-chrome'
      ? process.env.HARNESS_MANAGER_URL
      : undefined),
  computerSupervisorToken:
    process.env.COMPUTER_SUPERVISOR_TOKEN?.trim() ||
    (process.env.COMPUTER_MODE === 'local-chrome'
      ? process.env.HARNESS_MANAGER_TOKEN
      : undefined),
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  computerMode:
    process.env.COMPUTER_MODE === 'local-chrome' ? 'local-chrome' : 'managed',
  harnessManagerUrl: process.env.HARNESS_MANAGER_URL,
  harnessManagerToken: process.env.HARNESS_MANAGER_TOKEN,
  voiceKey: process.env.VOICE_API_KEY,
  voiceModel: process.env.VOICE_MODEL,
  voiceName: process.env.VOICE_NAME ?? 'marin',
  runtimeUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/api/copilotkit`,
  ownerToken,
};
const platform = new Platform(store, workspace, config);
const researchConfig = {
  mode: 'live' as const,
  apiKey: config.apiKey,
  model: config.model,
  baseUrl: config.baseUrl,
  webSearchProvider: config.webSearchProvider,
  parallelApiKey: config.parallelApiKey,
  browserUrl: config.browserUrl,
  browserSecret: config.browserSecret,
};
const runner = new Runner(
  store,
  researchConfig,
  async (claim, _memories, signal, progress) => {
    const threadId = workspace.taskThread(claim.id);
    if (!threadId)
      throw new Error(
        'This legacy task has no local conversation. Create a new scheduled task from a conversation.',
      );
    progress('Running this task in its local conversation.');
    const text = await platform.turn(threadId, claim.prompt, signal, {
      opendotsSource: 'scheduled_task',
    });
    return { text, sources: [], sample: false };
  },
);
const app = createApp({
  store,
  runner,
  config: researchConfig,
  ownerToken,
  origin: resolveAppOrigins(process.env.APP_ORIGIN, process.env.NODE_ENV),
  platform,
  ownerPasswordHash,
  authenticateOwner: (password) =>
    authenticateOwnerPassword(password, ownerPasswordHash!),
});
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  await next();
});
app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`ACTUALLY Open Dots listening on http://${host}:${info.port}`);
  runner.start();
});
setInterval(() => platform.persistRuntimeHistory(), 2000).unref();
const shutdown = createShutdown({
  stopRunner: () => runner.stop(),
  stopPlatform: async () => {},
  closeServer: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  exit: (code) => process.exit(code),
  report: (operation, error) => console.error(`${operation}: ${String(error)}`),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
