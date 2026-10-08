import { expect, it } from 'vitest';
import { Platform } from '../src/server/platform.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';

const config: PlatformConfig = {
  apiKey: 'fixture',
  model: 'fixture',
  baseUrl: 'https://example.com',
  runtimeUrl: '',
  voiceName: 'marin',
};

it('uses the local SSE runtime without hosted conversation credentials', async () => {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  try {
    const platform = new Platform(store, workspace, config);
    const response = await platform.handle(
      new Request('http://127.0.0.1/api/copilotkit/info'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'sse' });
    expect(platform.setup().missing).toEqual([]);
  } finally {
    store.close();
    workspace.close();
  }
});

it('recognizes the selected named resident connection as ready', () => {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  try {
    store.updateProviderConfig({
      kind: 'custom',
      baseUrl: '',
      model: '',
      apiKey: '',
      residentConnectionId: 'omniroute',
      connections: [
        {
          id: 'omniroute',
          name: 'OmniRoute',
          kind: 'omniroute',
          baseUrl: 'http://192.168.1.1:20128/v1',
          model: 'configured-model',
          apiKey: 'connection-key',
        },
      ],
    });
    const platform = new Platform(store, workspace, {
      ...config,
      apiKey: undefined,
      model: undefined,
      baseUrl: '',
    });

    expect(platform.setup()).toMatchObject({ model: true, missing: [] });
  } finally {
    store.close();
    workspace.close();
  }
});
