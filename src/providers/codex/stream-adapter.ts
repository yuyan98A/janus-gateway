import { randomUUID } from 'node:crypto';
import type {
  AnthropicEvent,
  OpenAIChatChunk
} from '../../types.ts';
import type { GatewayStreamEventIR } from '../../protocol/ir.ts';
import { toAnthropicEventStream, toOpenAIChatChunkStream } from '../../protocol/egress.ts';
import { parseEventSourceStream } from '../../utils/event-source-parser.ts';

export class CodexStreamAdapter {
  /**
   * Transforms Codex Responses SSE stream into Canonical GatewayStreamEventIR generator
   */
  public static async *toUnifiedStream(
    responseStream: ReadableStream<Uint8Array>,
    requestedModel: string
  ): AsyncGenerator<GatewayStreamEventIR> {
    let currentBlockType: 'text' | 'thinking' | 'tool_use' | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let hasToolCalls = false;

    for await (const sse of parseEventSourceStream(responseStream)) {
      let payload: any;
      try {
        payload = JSON.parse(sse.data);
      } catch {
        continue;
      }

      const type = payload.type || sse.event;

      // 1. Response created or in progress
      if (type === 'response.created' || type === 'response.in_progress') {
        const resp = payload.response || {};
        yield {
          type: 'start',
          id: resp.id || '',
          model: resp.model || requestedModel,
          inputTokens
        };
        continue;
      }

      // 2. Output item added (new message, function_call, or reasoning)
      if (type === 'response.output_item.added') {
        const item = payload.item || {};

        if (currentBlockType !== null) {
          if (currentBlockType === 'text') yield { type: 'text_stop' };
          else if (currentBlockType === 'thinking') yield { type: 'thinking_stop' };
          else if (currentBlockType === 'tool_use') yield { type: 'tool_call_stop' };
          currentBlockType = null;
        }

        if (item.type === 'message') {
          currentBlockType = 'text';
          yield { type: 'text_start' };
        } else if (item.type === 'reasoning') {
          currentBlockType = 'thinking';
          yield { type: 'thinking_start' };
        } else if (item.type === 'function_call') {
          currentBlockType = 'tool_use';
          hasToolCalls = true;
          yield {
            type: 'tool_call_start',
            id: item.call_id || item.id || `call_${randomUUID().replace(/-/g, '')}`,
            name: item.name || ''
          };
        }
        continue;
      }

      // 3. Output text delta
      if (type === 'response.output_text.delta') {
        if (payload.delta) {
          yield {
            type: 'text_delta',
            text: payload.delta
          };
        }
        continue;
      }

      // 4. Reasoning text delta
      if (type === 'response.reasoning_text.delta') {
        if (payload.delta) {
          yield {
            type: 'thinking_delta',
            text: payload.delta
          };
        }
        continue;
      }

      // 5. Function call arguments delta
      if (type === 'response.function_call_arguments.delta') {
        if (payload.delta) {
          yield {
            type: 'tool_call_delta',
            argsDelta: payload.delta
          };
        }
        continue;
      }

      // 6. Output item done
      if (type === 'response.output_item.done') {
        if (currentBlockType !== null) {
          if (currentBlockType === 'text') yield { type: 'text_stop' };
          else if (currentBlockType === 'thinking') yield { type: 'thinking_stop' };
          else if (currentBlockType === 'tool_use') yield { type: 'tool_call_stop' };
          currentBlockType = null;
        }
        continue;
      }

      // 7. Response completed or incomplete
      if (type === 'response.completed' || type === 'response.incomplete') {
        const resp = payload.response || {};
        if (resp.usage) {
          inputTokens = resp.usage.input_tokens ?? inputTokens;
          outputTokens = resp.usage.output_tokens ?? outputTokens;
        }

        const isMaxTokens =
          type === 'response.incomplete' ||
          resp.status === 'incomplete' ||
          resp.incomplete_details?.reason === 'max_output_tokens';

        yield {
          type: 'finish',
          stopReason: hasToolCalls ? 'tool_use' : (isMaxTokens ? 'max_tokens' : 'end_turn'),
          inputTokens,
          outputTokens
        };
        continue;
      }

      // 8. Stream error or failed
      if (type === 'response.failed' || type === 'error') {
        const errorMsg = payload.error?.message || payload.message || 'Codex upstream stream failed';
        yield {
          type: 'error',
          message: errorMsg
        };
        throw new Error(errorMsg);
      }
    }
  }

  /**
   * Convert Codex Responses SSE stream into Anthropic SSE events
   */
  public static async *toAnthropicStream(
    responseStream: ReadableStream<Uint8Array>,
    requestedModel: string
  ): AsyncGenerator<AnthropicEvent> {
    yield* toAnthropicEventStream(
      this.toUnifiedStream(responseStream, requestedModel),
      requestedModel
    );
  }

  /**
   * Convert Codex Responses SSE stream into OpenAI Chat Completions chunk stream
   */
  public static async *toOpenAIChatStream(
    responseStream: ReadableStream<Uint8Array>,
    requestedModel: string
  ): AsyncGenerator<OpenAIChatChunk> {
    yield* toOpenAIChatChunkStream(
      this.toUnifiedStream(responseStream, requestedModel),
      requestedModel
    );
  }
}
