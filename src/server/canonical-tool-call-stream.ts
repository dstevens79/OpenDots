import { EventType, type StreamChunk } from '@tanstack/ai';

/**
 * CopilotKit's TanStack-to-AG-UI converter forwards streamed argument deltas
 * but drops TanStack's parsed TOOL_CALL_END.input. Keep the browser's persisted
 * tool-call arguments aligned with the input the server actually executed.
 */
export async function* canonicalToolCallArgumentStream(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const streamedArguments = new Map<string, string>();

  for await (const chunk of stream) {
    if (chunk.type === 'TOOL_CALL_ARGS') {
      streamedArguments.set(
        chunk.toolCallId,
        (streamedArguments.get(chunk.toolCallId) ?? '') + chunk.delta,
      );
      continue;
    }

    if (chunk.type === 'TOOL_CALL_END') {
      const accumulated = streamedArguments.get(chunk.toolCallId) ?? '';
      streamedArguments.delete(chunk.toolCallId);

      let canonicalArguments: string;
      if (chunk.input !== undefined) {
        canonicalArguments = JSON.stringify(chunk.input) ?? '{}';
      } else {
        try {
          JSON.parse(accumulated);
          canonicalArguments = accumulated;
        } catch {
          // Keep the conversation usable if the provider supplied malformed
          // arguments and TanStack could not produce a parsed input.
          canonicalArguments = '{}';
        }
      }

      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: chunk.toolCallId,
        delta: canonicalArguments,
      };
    }

    yield chunk;
  }
}
