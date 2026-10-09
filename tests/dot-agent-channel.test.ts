import { afterEach, expect, it, vi } from 'vitest';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { Observable, lastValueFrom, of, throwError, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';

const inner = vi.hoisted(() => ({
  configure: vi.fn(),
  run: vi.fn<(input: RunAgentInput) => Observable<BaseEvent>>(),
  abortRun: vi.fn(),
}));
vi.mock('@copilotkit/runtime/v2', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@copilotkit/runtime/v2')>();
  return {
    ...original,
    BuiltInAgent: class {
      constructor(options: unknown) {
        inner.configure(options);
      }
      run = inner.run;
      abortRun = inner.abortRun;
    },
  };
});
const databases: Array<{ close(): void }> = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
  inner.configure.mockClear();
});
function fixture(channel = true) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'Test');
  const agent = new DotAgent(
    store,
    workspace,
    {
      apiKey: 'fixture',
      model: 'fixture',
      baseUrl: 'https://unused.invalid',
      runtimeUrl: '',
      voiceName: 'marin',
    },
    dot.id,
    channel,
  );
  const input: RunAgentInput = {
    threadId: 'thread',
    runId: 'run',
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  };
  return { agent, input };
}

it('sanitizes errors before they reach a non-web channel', async () => {
  const { agent, input } = fixture();
  inner.run.mockReturnValue(throwError(() => new Error('SECRET transport')));
  const events = await lastValueFrom(agent.run(input).pipe(toArray()));
  expect(events).toEqual([
    {
      type: EventType.RUN_ERROR,
      message:
        'ACTUALLY Open Dots could not complete this request. Please check the app and try again.',
    },
  ]);
  expect(JSON.stringify(events)).not.toContain('SECRET');
});

it('keeps local web-agent provider errors visible for diagnosis', async () => {
  const { agent, input } = fixture(false);
  const error = { type: EventType.RUN_ERROR, message: 'Provider details' };
  inner.run.mockReturnValue(of(error));
  expect(await lastValueFrom(agent.run(input).pipe(toArray()))).toEqual([
    error,
  ]);
});
