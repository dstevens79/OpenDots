import { expect, it } from 'vitest';
import { providerForTurn } from '../src/server/model-role.js';
import type { ProviderConfig } from '../src/server/store.js';

const resident: ProviderConfig = {
  kind: 'omniroute',
  baseUrl: 'http://omniroute/v1',
  model: 'resident-model',
  apiKey: 'resident-key',
  housekeepingKind: 'hermes',
  housekeepingBaseUrl: 'http://hermes:8642/v1',
  housekeepingModel: 'small-local-model',
  housekeepingApiKey: 'housekeeping-key',
};

it('keeps normal resident turns on the resident model', () => {
  expect(providerForTurn(resident, false)).toBe(resident);
});

it('routes scheduled work to the configured housekeeping model and credentials', () => {
  expect(providerForTurn(resident, true)).toMatchObject({
    kind: 'hermes',
    baseUrl: 'http://hermes:8642/v1',
    model: 'small-local-model',
    apiKey: 'housekeeping-key',
  });
});

it('falls back to resident when the background profile is incomplete', () => {
  const incomplete = { ...resident, housekeepingModel: '' };
  expect(providerForTurn(incomplete, true)).toBe(incomplete);
});

it('uses a selected named connection for each role', () => {
  const configured: ProviderConfig = {
    ...resident,
    residentConnectionId: 'omniroute-profile',
    housekeepingConnectionId: 'local-profile',
    connections: [
      {
        id: 'omniroute-profile',
        name: 'OmniRoute',
        kind: 'omniroute',
        baseUrl: 'http://omniroute/v1',
        model: 'resident-model',
        apiKey: 'resident-key',
      },
      {
        id: 'local-profile',
        name: 'Local small model',
        kind: 'custom',
        baseUrl: 'http://llama-cpp:8080/v1',
        model: 'housekeeping-small',
        apiKey: 'local-key',
      },
    ],
  };
  expect(providerForTurn(configured, false)).toMatchObject({
    baseUrl: 'http://omniroute/v1',
    model: 'resident-model',
    apiKey: 'resident-key',
  });
  expect(providerForTurn(configured, true)).toMatchObject({
    baseUrl: 'http://llama-cpp:8080/v1',
    model: 'small-local-model',
    apiKey: 'local-key',
  });
});

it('lets housekeeping share the resident connection while using its selected model', () => {
  const configured: ProviderConfig = {
    kind: 'omniroute',
    baseUrl: '',
    model: 'resident-model',
    residentConnectionId: 'shared',
    housekeepingConnectionId: 'shared',
    housekeepingModel: '',
    connections: [
      {
        id: 'shared',
        name: 'OpenAI',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        apiKey: 'shared-key',
      },
    ],
  };
  expect(providerForTurn(configured, true)).toMatchObject({
    model: 'resident-model',
    apiKey: 'shared-key',
    baseUrl: 'https://api.openai.com/v1',
  });
});
