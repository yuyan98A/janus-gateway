import crypto from 'node:crypto';
import type {
  AnthropicEvent,
  OpenAIChatChunk
} from '../types.ts';
import type {
  GatewayStreamEventIR
} from './ir.ts';

/**
 * Serializes GatewayStreamEventIR generator into AnthropicEvent SSE events
 */
export async function* toAnthropicEventStream(
  stream: AsyncGenerator<GatewayStreamEventIR>,
  requestedModel: string
): AsyncGenerator<AnthropicEvent> {
  let messageStarted = false;
  let messageId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
  let currentBlockIndex = -1;
  let activeBlockType: 'text' | 'thinking' | 'tool_use' | null = null;
  let toolCallCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let stopReason: 'end_turn' | 'max_tokens' | 'tool_use' = 'end_turn';

  function ensureMessageStart(modelName: string): AnthropicEvent[] {
    if (!messageStarted) {
      messageStarted = true;
      return [
        {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: modelName || requestedModel,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: inputTokens,
              output_tokens: 0,
              cache_read_input_tokens: cacheReadTokens,
              cache_creation_input_tokens: 0
            }
          }
        }
      ];
    }
    return [];
  }

  try {
    for await (const event of stream) {
      if (event.type === 'start') {
        if (event.id) messageId = event.id;
        if (event.inputTokens !== undefined) inputTokens = event.inputTokens;
        if (event.cacheReadTokens !== undefined) cacheReadTokens = event.cacheReadTokens;
        for (const ev of ensureMessageStart(event.model)) {
          yield ev;
        }
        continue;
      }

      if (event.type === 'thinking_start' || event.type === 'thinking_delta') {
        for (const ev of ensureMessageStart(requestedModel)) {
          yield ev;
        }

        if (activeBlockType !== 'thinking') {
          if (activeBlockType !== null && currentBlockIndex >= 0) {
            yield { type: 'content_block_stop', index: currentBlockIndex };
          }
          currentBlockIndex++;
          activeBlockType = 'thinking';
          yield {
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: { type: 'thinking', thinking: '' }
          };
        }

        if (event.type === 'thinking_delta' && event.text) {
          yield {
            type: 'content_block_delta',
            index: currentBlockIndex,
            delta: { type: 'thinking_delta', thinking: event.text }
          };
        }
        continue;
      }

      if (event.type === 'signature_delta' && event.signature) {
        if (activeBlockType === 'thinking' && currentBlockIndex >= 0) {
          yield {
            type: 'content_block_delta',
            index: currentBlockIndex,
            delta: { type: 'signature_delta', signature: event.signature }
          };
        }
        continue;
      }

      if (event.type === 'thinking_stop') {
        if (activeBlockType === 'thinking' && currentBlockIndex >= 0) {
          if (event.signature) {
            yield {
              type: 'content_block_delta',
              index: currentBlockIndex,
              delta: { type: 'signature_delta', signature: event.signature }
            };
          }
          yield { type: 'content_block_stop', index: currentBlockIndex };
          activeBlockType = null;
        }
        continue;
      }

      if (event.type === 'text_start' || event.type === 'text_delta') {
        for (const ev of ensureMessageStart(requestedModel)) {
          yield ev;
        }

        if (activeBlockType !== 'text') {
          if (activeBlockType !== null && currentBlockIndex >= 0) {
            yield { type: 'content_block_stop', index: currentBlockIndex };
          }
          currentBlockIndex++;
          activeBlockType = 'text';
          yield {
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: { type: 'text', text: '' }
          };
        }

        if (event.type === 'text_delta' && event.text) {
          yield {
            type: 'content_block_delta',
            index: currentBlockIndex,
            delta: { type: 'text_delta', text: event.text }
          };
        }
        continue;
      }

      if (event.type === 'text_stop') {
        if (activeBlockType === 'text' && currentBlockIndex >= 0) {
          yield { type: 'content_block_stop', index: currentBlockIndex };
          activeBlockType = null;
        }
        continue;
      }

      if (event.type === 'tool_call_start') {
        for (const ev of ensureMessageStart(requestedModel)) {
          yield ev;
        }

        if (activeBlockType !== null && currentBlockIndex >= 0) {
          yield { type: 'content_block_stop', index: currentBlockIndex };
        }

        toolCallCount++;
        currentBlockIndex++;
        activeBlockType = 'tool_use';
        yield {
          type: 'content_block_start',
          index: currentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: {}
          }
        };
        continue;
      }

      if (event.type === 'tool_call_delta') {
        for (const ev of ensureMessageStart(requestedModel)) {
          yield ev;
        }

        if (activeBlockType !== 'tool_use') {
          if (activeBlockType !== null && currentBlockIndex >= 0) {
            yield { type: 'content_block_stop', index: currentBlockIndex };
          }
          toolCallCount++;
          currentBlockIndex++;
          activeBlockType = 'tool_use';
          yield {
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: event.id || `call_${crypto.randomUUID()}`,
              name: event.name || 'function',
              input: {}
            }
          };
        }

        if (event.argsDelta) {
          yield {
            type: 'content_block_delta',
            index: currentBlockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: event.argsDelta
            }
          };
        }
        continue;
      }

      if (event.type === 'tool_call_stop') {
        if (activeBlockType === 'tool_use' && currentBlockIndex >= 0) {
          yield { type: 'content_block_stop', index: currentBlockIndex };
          activeBlockType = null;
        }
        continue;
      }

      if (event.type === 'finish') {
        if (event.inputTokens !== undefined) inputTokens = event.inputTokens;
        if (event.outputTokens !== undefined) outputTokens = event.outputTokens;
        if (event.cacheReadTokens !== undefined) cacheReadTokens = event.cacheReadTokens;
        if (event.stopReason === 'max_tokens') {
          stopReason = 'max_tokens';
        } else if (event.stopReason === 'tool_use') {
          stopReason = 'tool_use';
        } else {
          stopReason = 'end_turn';
        }
        continue;
      }
    }
  } finally {
    // Close active content block if left open
    if (activeBlockType !== null && currentBlockIndex >= 0) {
      yield {
        type: 'content_block_stop',
        index: currentBlockIndex
      };
    }

    // Ensure message_start was sent even if empty
    for (const ev of ensureMessageStart(requestedModel)) {
      yield ev;
    }

    yield {
      type: 'message_delta',
      delta: {
        stop_reason: toolCallCount > 0 ? 'tool_use' : stopReason,
        stop_sequence: null
      },
      usage: {
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadTokens,
        cache_creation_input_tokens: 0
      }
    };

    yield { type: 'message_stop' };
  }
}

/**
 * Serializes GatewayStreamEventIR generator into OpenAIChatChunk SSE chunks
 */
export async function* toOpenAIChatChunkStream(
  stream: AsyncGenerator<GatewayStreamEventIR>,
  requestedModel: string
): AsyncGenerator<OpenAIChatChunk> {
  const chunkId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;
  const created = Math.floor(Date.now() / 1000);
  let resolvedModel = requestedModel;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let currentToolCallIndex = -1;
  let currentToolCallId = '';
  let finishReason: OpenAIChatChunk['choices'][0]['finish_reason'] = null;

  function baseChunk(choices: OpenAIChatChunk['choices'], usage?: OpenAIChatChunk['usage']): OpenAIChatChunk {
    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created,
      model: resolvedModel,
      choices,
      ...(usage ? { usage } : {})
    };
  }

  for await (const event of stream) {
    if (event.type === 'start') {
      if (event.model) resolvedModel = event.model;
      if (event.inputTokens !== undefined) inputTokens = event.inputTokens;
      if (event.cacheReadTokens !== undefined) cacheReadTokens = event.cacheReadTokens;
      continue;
    }

    if (event.type === 'thinking_delta' && event.text) {
      yield baseChunk([
        {
          index: 0,
          delta: {
            reasoning_content: event.text
          },
          finish_reason: null
        }
      ]);
      continue;
    }

    if (event.type === 'text_delta' && event.text) {
      yield baseChunk([
        {
          index: 0,
          delta: {
            content: event.text
          },
          finish_reason: null
        }
      ]);
      continue;
    }

    if (event.type === 'tool_call_start') {
      currentToolCallIndex++;
      currentToolCallId = event.id;
      yield baseChunk([
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: currentToolCallIndex,
                id: event.id,
                type: 'function',
                function: {
                  name: event.name,
                  arguments: ''
                }
              }
            ]
          },
          finish_reason: null
        }
      ]);
      continue;
    }

    if (event.type === 'tool_call_delta') {
      if (currentToolCallIndex === -1) {
        currentToolCallIndex = 0;
        currentToolCallId = event.id || `call_${crypto.randomUUID()}`;
      }

      yield baseChunk([
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: currentToolCallIndex,
                id: event.id || currentToolCallId,
                type: 'function',
                function: {
                  arguments: event.argsDelta
                }
              }
            ]
          },
          finish_reason: null
        }
      ]);
      continue;
    }

    if (event.type === 'finish') {
      if (event.inputTokens !== undefined) inputTokens = event.inputTokens;
      if (event.outputTokens !== undefined) outputTokens = event.outputTokens;
      if (event.cacheReadTokens !== undefined) cacheReadTokens = event.cacheReadTokens;
      if (currentToolCallIndex >= 0 || event.stopReason === 'tool_use') {
        finishReason = 'tool_calls';
      } else if (event.stopReason === 'max_tokens') {
        finishReason = 'length';
      } else {
        finishReason = 'stop';
      }
      continue;
    }
  }

  // Final chunk with finish_reason and usage
  yield baseChunk(
    [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason || 'stop'
      }
    ],
    {
      prompt_tokens: inputTokens + cacheReadTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + cacheReadTokens + outputTokens,
      ...(cacheReadTokens > 0
        ? { prompt_tokens_details: { cached_tokens: cacheReadTokens } }
        : {})
    }
  );
}
