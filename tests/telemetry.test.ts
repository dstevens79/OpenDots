import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const run = promisify(execFile);
const platformUrl = new URL('../src/server/platform.ts', import.meta.url).href;
const storeUrl = new URL('../src/server/store.ts', import.meta.url).href;
const workspaceUrl = new URL('../src/server/workspace.ts', import.meta.url)
  .href;
const tsxUrl = import.meta.resolve('tsx');

// Intercept the real SDK transport before import, in a fresh process so its
// singleton observes each environment. These probes never send live telemetry.
const probe = `
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
  return new Response('{"ok":true}', { status: 202 });
};
const { Platform } = await import(${JSON.stringify(platformUrl)});
const { Store } = await import(${JSON.stringify(storeUrl)});
const { WorkspaceStore } = await import(${JSON.stringify(workspaceUrl)});
const store = new Store(':memory:');
const workspace = new WorkspaceStore(':memory:', 'fixture-owner');
try {
  const platform = new Platform(store, workspace, {
    baseUrl: '', runtimeUrl: '', voiceName: 'marin',
  });
  await platform.handle(new Request('http://localhost/api/copilotkit/info'));
  const dot = workspace.dots()[0];
  workspace.bindThread('fixture-thread', dot.id, 'Fixture');
  // Reach the SDK request handler, then fail body validation before any agent run.
  const response = await platform.handle(new Request(
    'http://localhost/api/copilotkit/agent/' + dot.id + '/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'fixture-thread', messages: 'invalid' }),
    },
  ));
  if (response.status !== 400) throw new Error('Expected SDK body validation failure');
  await new Promise(resolve => setImmediate(resolve));
  console.log(JSON.stringify(requests));
} finally {
  store.close();
  workspace.close();
}
`;

interface CapturedEvent {
  url: string;
  headers: Record<string, string>;
  body: {
    event: string;
    global_properties: {
      copilotkit_package_version?: string;
      sampleRate: number;
      installation_id?: string;
      opendots_distribution?: string;
    };
  };
}

async function captureRuntime(overrides: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_OPTIONS: '',
  };
  for (const key of [
    'DO_NOT_TRACK',
    'COPILOTKIT_TELEMETRY_DISABLED',
    'COPILOTKIT_TELEMETRY_SAMPLE_RATE',
    'COPILOTKIT_LICENSE_TOKEN',
    'COPILOTKIT_TELEMETRY_URL',
  ])
    delete env[key];
  const { stdout } = await run(
    process.execPath,
    ['--import', tsxUrl, '--input-type=module', '--eval', probe],
    {
      env: { ...env, CPK_TELEMETRY_ID: 'test-project-identity', ...overrides },
      timeout: 15000,
    },
  );
  const events: CapturedEvent[] = JSON.parse(
    stdout.trim().split('\n').at(-1) ?? '[]',
  );
  return events;
}

it('sends ACTUALLY Open Dots runtime metadata with CLI identity and without the project key', async () => {
  const events = await captureRuntime({
    DO_NOT_TRACK: '0',
    COPILOTKIT_TELEMETRY_DISABLED: 'false',
  });
  const created = events.find(
    (event) => event.body.event === 'oss.runtime.instance_created',
  );
  expect(created).toBeDefined();
  expect(created?.url).toBe('https://telemetry.copilotkit.ai/ingest');
  expect(created?.headers['X-CopilotKit-Telemetry-Id']).toBe(
    'test-project-identity',
  );
  expect(created?.body.global_properties.sampleRate).toBe(1);
  expect(created?.body.global_properties.sampleRate).toBe(1);
  const request = events.find(
    (event) => event.body.event === 'oss.runtime.copilot_request_created',
  );
  expect(request).toBeDefined();
  expect(request?.headers['X-CopilotKit-Telemetry-Id']).toBe(
    'test-project-identity',
  );
  expect(JSON.stringify(events)).not.toContain('test-project-key-never-sent');
  expect(
    events.some((event) => event.body.event === 'intelligence_signup'),
  ).toBe(false);
});

it.each([
  ['DO_NOT_TRACK', 'true'],
  ['DO_NOT_TRACK', '1'],
  ['COPILOTKIT_TELEMETRY_DISABLED', 'true'],
  ['COPILOTKIT_TELEMETRY_DISABLED', '1'],
  ['COPILOTKIT_TELEMETRY_SAMPLE_RATE', '0'],
])('respects %s=%s', async (key, value) => {
  expect(await captureRuntime({ [key]: value })).toEqual([]);
});

it('hands the persistent installation fallback to the installed runtime when CLI identity is absent', async () => {
  const events = await captureRuntime({
    CPK_TELEMETRY_ID: '',
    DO_NOT_TRACK: '0',
    COPILOTKIT_TELEMETRY_DISABLED: 'false',
  });
  const created = events.find(
    (event) => event.body.event === 'oss.runtime.instance_created',
  );
  expect(created).toBeDefined();
  expect(created?.headers['X-CopilotKit-Telemetry-Id']).toBeUndefined();
  expect(created?.body.global_properties.sampleRate).toBe(1);
});
