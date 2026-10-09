import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Store, type ModelConnection } from '../src/server/store.js';

const store = new Store(process.argv[2] || '/var/lib/opendots/opendots.sqlite');
const rl = createInterface({ input, output });
const ask = async (question: string, fallback = '') => {
  const answer = (
    await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)
  ).trim();
  return answer || fallback;
};
const secret = async (question: string) => {
  if (!input.isTTY)
    throw new Error('Secure API-key entry requires an interactive terminal.');
  execFileSync('stty', ['-echo'], { stdio: 'inherit' });
  try {
    const value = await rl.question(`${question}: `);
    output.write('\n');
    return value.trim();
  } finally {
    execFileSync('stty', ['echo'], { stdio: 'inherit' });
  }
};

async function main() {
  console.log(
    '\nConnect an AI endpoint for the two starter roles. This is optional.',
  );
  console.log(
    'Keys are saved in the local Open Dots database and are hidden while you type.',
  );
  if (
    (await ask('Configure model connections now? (y/N)', 'n')).toLowerCase() !==
    'y'
  )
    return;

  const existing = store.providerConfig();
  const connections = [...(existing.connections ?? [])];
  while (true) {
    console.log(
      '\nChoose a provider: 1) OmniRoute  2) OpenRouter  3) Custom OpenAI-compatible endpoint  0) Done',
    );
    const choice = await ask('Provider', '0');
    if (choice === '0') break;
    if (!['1', '2', '3'].includes(choice)) {
      console.log('Choose 0, 1, 2, or 3.');
      continue;
    }
    const kind: ModelConnection['kind'] =
      choice === '1' ? 'omniroute' : 'custom';
    const name =
      choice === '1'
        ? 'OmniRoute'
        : choice === '2'
          ? 'OpenRouter'
          : 'Custom endpoint';
    const defaultUrl = choice === '2' ? 'https://openrouter.ai/api/v1' : '';
    const baseUrl = await ask(`${name} base URL`, defaultUrl);
    if (!baseUrl) {
      console.log('An endpoint URL is required.');
      continue;
    }
    const apiKey = await secret(
      `${name} API key (leave blank if not required)`,
    );
    let models: string[] = [];
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data?: { id?: string }[] };
      models = (body.data ?? []).flatMap((model) =>
        model.id ? [model.id] : [],
      );
      console.log(
        `Connected. ${models.length} model${models.length === 1 ? '' : 's'} listed.`,
      );
    } catch (error) {
      console.log(
        `Could not list models (${error instanceof Error ? error.message : 'connection failed'}). You can enter a model ID manually.`,
      );
    }
    let model = '';
    if (models.length) {
      models.forEach((id, index) => console.log(`  ${index + 1}) ${id}`));
      const selection = await ask(
        'Default model number, or enter a model ID',
        '1',
      );
      const index = Number(selection) - 1;
      model =
        Number.isInteger(index) && index >= 0 && index < models.length
          ? models[index]!
          : selection;
    } else {
      model = await ask('Model ID');
    }
    if (!model) {
      console.log('No model selected; endpoint skipped.');
      continue;
    }
    const id = randomUUID();
    connections.push({
      id,
      name: await ask('Connection name', name),
      kind,
      baseUrl,
      model,
      ...(apiKey ? { apiKey } : {}),
    });
    console.log('Connection added.');
    if ((await ask('Add another endpoint? (y/N)', 'n')).toLowerCase() !== 'y')
      break;
  }
  if (!connections.length) {
    console.log(
      'No model connections are configured yet. You can add them later in Settings → Connections.',
    );
    return;
  }
  console.log('\nChoose the model for each role:');
  const selectRole = async (
    label: string,
    fallbackId?: string,
    fallbackModel?: string,
  ) => {
    connections.forEach((connection, index) =>
      console.log(`  ${index + 1}) ${connection.name} — ${connection.model}`),
    );
    const raw = await ask(
      `${label} connection number`,
      fallbackId
        ? String(
            Math.max(1, connections.findIndex((c) => c.id === fallbackId) + 1),
          )
        : '1',
    );
    const index = Number(raw) - 1;
    const connection =
      Number.isInteger(index) && index >= 0 ? connections[index] : undefined;
    if (!connection) {
      console.log('Invalid selection; keeping the current assignment.');
      return { id: fallbackId, model: fallbackModel };
    }
    const model = await ask(`${label} model`, connection.model);
    return { id: connection.id, model };
  };
  const resident = await selectRole(
    'Resident AI',
    existing.residentConnectionId,
    existing.model,
  );
  const housekeeping = await selectRole(
    'Housekeeping AI',
    existing.housekeepingConnectionId,
    existing.housekeepingModel,
  );
  store.updateProviderConfig({
    connections,
    ...(resident.id ? { residentConnectionId: resident.id } : {}),
    ...(resident.model ? { model: resident.model } : {}),
    ...(housekeeping.id ? { housekeepingConnectionId: housekeeping.id } : {}),
    ...(housekeeping.model ? { housekeepingModel: housekeeping.model } : {}),
  });
  console.log(
    'Saved. Resident AI and Housekeeping AI are now assigned. You can change them in Settings → Models.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    store.close();
  });
