import { EventType, type StreamChunk } from '@tanstack/ai';

/** Repair malformed arguments already persisted in a browser's chat history. */
export function sanitizeToolCallHistory<T>(messages: T[]): T[] {
  return messages.map((message) => {
    if (message === null || typeof message !== 'object') return message;
    const record = message as { role?: unknown; toolCalls?: unknown };
    if (record.role !== 'assistant' || !Array.isArray(record.toolCalls))
      return message;

    let repaired = false;
    const toolCalls = record.toolCalls.map((toolCall: unknown) => {
      if (toolCall === null || typeof toolCall !== 'object') return toolCall;
      const call = toolCall as {
        function?: { arguments?: unknown; [key: string]: unknown };
        [key: string]: unknown;
      };
      const fn = call.function;
      if (!fn || typeof fn.arguments !== 'string') return toolCall;
      try {
        JSON.parse(fn.arguments);
        return toolCall;
      } catch {
        repaired = true;
        return { ...call, function: { ...fn, arguments: '{}' } };
      }
    });

    return repaired ? ({ ...record, toolCalls } as T) : message;
  });
}

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
