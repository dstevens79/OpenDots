import { expect, it } from 'vitest';
import { EventType, type StreamChunk } from '@tanstack/ai';
import { canonicalToolCallArgumentStream } from '../src/server/canonical-tool-call-stream.js';

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of canonicalToolCallArgumentStream(stream))
    chunks.push(chunk);
  return chunks;
}

async function* chunks(...items: StreamChunk[]) {
  yield* items;
}

it('replaces fragmented or duplicated arguments with TanStack parsed input', async () => {
  const result = await collect(
    chunks(
      { type: 'TOOL_CALL_START', toolCallId: 'call-1', toolCallName: 'list' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-1', delta: '{}' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-1', delta: '{}' },
      {
        type: 'TOOL_CALL_END',
        toolCallId: 'call-1',
        input: { path: '/workspace' },
      },
    ),
  );

  expect(result.filter((chunk) => chunk.type === 'TOOL_CALL_ARGS')).toEqual([
    {
      type: 'TOOL_CALL_ARGS',
      toolCallId: 'call-1',
      delta: '{"path":"/workspace"}',
    },
  ]);
});

it('preserves valid raw JSON and repairs malformed raw JSON when no parsed input exists', async () => {
  const result = await collect(
    chunks(
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'valid',
        delta: '{"limit":2}',
      },
      { type: 'TOOL_CALL_END', toolCallId: 'valid' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'broken', delta: '{}{}' },
      { type: 'TOOL_CALL_END', toolCallId: 'broken' },
    ),
  );

  expect(result.filter((chunk) => chunk.type === 'TOOL_CALL_ARGS')).toEqual([
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: 'valid',
      delta: '{"limit":2}',
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: 'broken', delta: '{}' },
  ]);
});
