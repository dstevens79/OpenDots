import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runThreadTurn } from '../src/server/headless.js';

const sdk = vi.hoisted(() => ({
  run: vi.fn(),
  detach: vi.fn(),
  abort: vi.fn(),
  message: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@ag-ui/client', () => ({
  HttpAgent: class {
    constructor(config: unknown) {
      sdk.config(config);
    }
    addMessage(message: unknown) {
      sdk.message(message);
    }
    runAgent() {
      return sdk.run();
    }
    detachActiveRun() {
      return sdk.detach();
    }
    abortRun() {
      sdk.abort();
    }
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

it('runs server turns through the local AG-UI HTTP endpoint', async () => {
  sdk.run.mockResolvedValue({
    newMessages: [
      { id: 'reply', role: 'assistant', content: 'Confirmed receipt' },
    ],
  });
  await expect(
    runThreadTurn(
      'http://127.0.0.1:4310/api/copilotkit/',
      { Authorization: 'Bearer test' },
      'dot',
      'thread',
      'Record my call',
      new AbortController().signal,
      { opendotsSource: 'voice_receipt' },
    ),
  ).resolves.toBe('Confirmed receipt');
  expect(sdk.config).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: 'dot',
      threadId: 'thread',
      url: 'http://127.0.0.1:4310/api/copilotkit/agent/dot/run',
      headers: { Authorization: 'Bearer test' },
    }),
  );
  expect(sdk.message).toHaveBeenCalledWith(
    expect.objectContaining({
      id: expect.stringMatching(/^opendots:voice_receipt:/),
      role: 'user',
      content: 'Record my call',
      metadata: { opendotsSource: 'voice_receipt' },
    }),
  );
  expect(sdk.detach).toHaveBeenCalledOnce();
});

it('marks scheduled prompts while preserving their text and user role', async () => {
  sdk.run.mockResolvedValue({
    newMessages: [
      { id: 'reply', role: 'assistant', content: 'Scheduled task complete' },
    ],
  });

  await runThreadTurn(
    'http://127.0.0.1:4310/api/copilotkit',
    {},
    'dot',
    'thread',
    'Check the nightly report',
    new AbortController().signal,
    { opendotsSource: 'scheduled_task' },
  );

  expect(sdk.message).toHaveBeenCalledWith(
    expect.objectContaining({
      id: expect.stringMatching(/^opendots:scheduled_task:/),
      role: 'user',
      content: 'Check the nightly report',
      metadata: { opendotsSource: 'scheduled_task' },
    }),
  );
});

it('rejects an empty assistant response and always tears down the local run', async () => {
  sdk.run.mockResolvedValue({
    newMessages: [{ id: 'user', role: 'user', content: 'hello' }],
  });
  await expect(
    runThreadTurn(
      'http://127.0.0.1:4310/api/copilotkit',
      {},
      'dot',
      'thread',
      'Call',
      new AbortController().signal,
    ),
  ).rejects.toThrow('no assistant response');
  expect(sdk.detach).toHaveBeenCalledOnce();
});

it('aborts the local HTTP turn when its owner operation is cancelled', async () => {
  const controller = new AbortController();
  sdk.run.mockImplementation(async () => {
    controller.abort(new Error('Call ended'));
    return {
      newMessages: [{ id: 'late', role: 'assistant', content: 'Late answer' }],
    };
  });
  await expect(
    runThreadTurn(
      'http://127.0.0.1:4310/api/copilotkit',
      {},
      'dot',
      'thread',
      'Call',
      controller.signal,
    ),
  ).rejects.toThrow('Call ended');
  expect(sdk.abort).toHaveBeenCalledOnce();
  expect(sdk.detach).toHaveBeenCalledOnce();
});

it('cleans up rejected server turns while preserving the error', async () => {
  sdk.run.mockRejectedValue(new Error('Local SSE run failed'));
  await expect(
    runThreadTurn(
      'http://127.0.0.1:4310/api/copilotkit',
      {},
      'dot',
      'thread',
      'Call',
      new AbortController().signal,
    ),
  ).rejects.toThrow('Local SSE run failed');
  expect(sdk.detach).toHaveBeenCalledOnce();
});
