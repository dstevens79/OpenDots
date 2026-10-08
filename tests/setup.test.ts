import { expect, it } from 'vitest';
import {
  setupStatus,
  type PlatformConfig,
} from '../src/server/platform-config.js';

const config: PlatformConfig = {
  apiKey: 'fixture',
  model: 'fixture',
  baseUrl: 'https://example.com',
  runtimeUrl: '',
  voiceName: 'marin',
};

it('requires only a configured model connection for local chat', () => {
  expect(setupStatus(config)).toMatchObject({
    model: true,
    voice: false,
    missing: [],
  });
  expect(setupStatus({ ...config, apiKey: '', model: '' }).missing).toEqual([
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
  ]);
});

it('reports local browser and separately configured realtime voice readiness', () => {
  expect(
    setupStatus({
      ...config,
      browserUrl: 'http://127.0.0.1:4311',
      browserSecret: 'secret',
      voiceKey: 'voice-key',
      voiceModel: 'voice-model',
    }),
  ).toMatchObject({ model: true, browser: true, voice: true });
});
