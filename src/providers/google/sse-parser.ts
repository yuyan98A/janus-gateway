import crypto from 'node:crypto';
import type { AnthropicEvent, OpenAIChatChunk } from '../../types.ts';
import type { GatewayStreamEventIR } from '../../protocol/ir.ts';
import { toAnthropicEventStream, toOpenAIChatChunkStream } from '../../protocol/egress.ts';
import { parseEventSourceStream } from '../../utils/event-source-parser.ts';
import { cacheSignature, cacheThinkingSignature } from './signature-cache.ts';
import { healGoogleToolCall, type ToolDefinitionLike } from './tool-healer.ts';

/**
 * Transforms Google Cloud Code PA SSE stream into Canonical GatewayStreamEventIR generator
 */
export async function* parseGoogleStreamToUnified(
  stream: ReadableStream<Uint8Array>,
  model: string,
  tools?: ToolDefinitionLike[]
): AsyncGenerator<GatewayStreamEventIR> {
  const messageId = `msg_${crypto.randomBytes(16).toString('hex')}`;
  const modelFamily: 'claude' | 'gemini' = model.toLowerCase().includes('claude') ? 'claude' : 'gemini';
  let hasEmittedStart = false;
  let currentBlockType: 'text' | 'tool_use' | 'thinking' | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let stopReason: 'end_turn' | 'max_tokens' | 'tool_use' = 'end_turn';
  let hasToolCalls = false;

  let currentThinkingSignature = '';
  const collectedGroundingChunks: any[] = [];
  let emittedTextAccumulator = '';

  for await (const sse of parseEventSourceStream(stream)) {
    if (!sse.data) continue;
    if (sse.data.trim() === '[DONE]') break;

    let parsed: any;
    try {
      parsed = JSON.parse(sse.data);
    } catch {
      continue;
    }

    const innerResponse = parsed.response || parsed;
    if (parsed.error || innerResponse.error) {
      throw new Error(`Google PA stream error: ${JSON.stringify(parsed.error || innerResponse.error).slice(0, 500)}`);
    }

    // Token usage with prompt caching deduction
    if (innerResponse.usageMetadata) {
      const promptTokens = innerResponse.usageMetadata.promptTokenCount || 0;
      const cachedTokens = innerResponse.usageMetadata.cachedContentTokenCount || 0;
      inputTokens = Math.max(0, promptTokens - cachedTokens);
      cacheReadTokens = cachedTokens;
      outputTokens = innerResponse.usageMetadata.candidatesTokenCount || outputTokens;
    }

    const candidate = innerResponse.candidates?.[0];
    if (!candidate) continue;

    // Accumulate Google Search Grounding metadata if present
    if (candidate.groundingMetadata?.groundingChunks) {
      for (const chunk of candidate.groundingMetadata.groundingChunks) {
        if (chunk?.web?.uri) {
          collectedGroundingChunks.push(chunk);
        }
      }
    }

    // 1. Emit start event on first chunk
    if (!hasEmittedStart) {
      hasEmittedStart = true;
      yield {
        type: 'start',
        id: messageId,
        model,
        inputTokens,
        cacheReadTokens
      };
    }

    if (candidate.finishReason === 'MAX_TOKENS') {
      stopReason = 'max_tokens';
    } else if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Google PA finished with ${candidate.finishReason}`);
    }

    const parts = candidate.content?.parts || [];

    // 2. Process content parts
    for (const part of parts) {
      if (part.thought) {
        if (currentBlockType !== 'thinking') {
          if (currentBlockType === 'text') yield { type: 'text_stop' };
          else if (currentBlockType === 'tool_use') yield { type: 'tool_call_stop' };
          currentBlockType = 'thinking';
          currentThinkingSignature = '';
          yield { type: 'thinking_start' };
        }

        const thinkingText = typeof part.thought === 'string' ? part.thought : part.text;
        if (typeof thinkingText === 'string' && thinkingText) {
          yield {
            type: 'thinking_delta',
            text: thinkingText
          };
        }

        if (part.thoughtSignature) {
          currentThinkingSignature = part.thoughtSignature;
          cacheThinkingSignature(part.thoughtSignature, modelFamily);
        }
      } else if (part.text) {
        if (currentBlockType !== 'text') {
          if (currentBlockType === 'thinking') {
            yield { type: 'thinking_stop', signature: currentThinkingSignature || undefined };
            currentThinkingSignature = '';
          } else if (currentBlockType === 'tool_use') {
            yield { type: 'tool_call_stop' };
          }
          currentBlockType = 'text';
          yield { type: 'text_start' };
        }

        emittedTextAccumulator += part.text;
        yield {
          type: 'text_delta',
          text: part.text
        };
      } else if (part.functionCall) {
        if (currentBlockType === 'thinking') {
          yield { type: 'thinking_stop', signature: currentThinkingSignature || undefined };
          currentThinkingSignature = '';
        } else if (currentBlockType === 'text') {
          yield { type: 'text_stop' };
        }

        currentBlockType = 'tool_use';
        hasToolCalls = true;
        const callId = part.functionCall.id || `call_${crypto.randomBytes(12).toString('hex')}`;
        const functionSignature = part.thoughtSignature || candidate.thoughtSignature;
        if (functionSignature) {
          cacheSignature(callId, functionSignature);
        }

        const toolName = part.functionCall.name || 'function';
        const rawArgs = part.functionCall.args || {};
        const healedArgs = healGoogleToolCall(toolName, rawArgs, tools);

        yield {
          type: 'tool_call_start',
          id: callId,
          name: toolName
        };
        yield {
          type: 'tool_call_delta',
          id: callId,
          argsDelta: JSON.stringify(healedArgs)
        };
        yield {
          type: 'tool_call_stop',
          id: callId
        };
        currentBlockType = null;
      }
    }
  }

  // If Google Grounding metadata was returned, ensure unique sources are appended
  // as markdown hyperlinks if not already present in the emitted text.
  if (collectedGroundingChunks.length > 0) {
    const uniqueSources: Array<{ uri: string; title: string }> = [];
    const seenUris = new Set<string>();

    for (const chunk of collectedGroundingChunks) {
      const uri = chunk.web?.uri;
      const title = (chunk.web?.title || uri || '').trim();
      if (uri && !seenUris.has(uri) && !emittedTextAccumulator.includes(uri)) {
        seenUris.add(uri);
        uniqueSources.push({ uri, title });
      }
    }

    if (uniqueSources.length > 0) {
      let sourcesMarkdown = '\n\n**Sources:**\n';
      for (const src of uniqueSources) {
        sourcesMarkdown += `- [${src.title}](${src.uri})\n`;
      }

      if (currentBlockType !== 'text') {
        if (currentBlockType === 'thinking') {
          yield { type: 'thinking_stop', signature: currentThinkingSignature || undefined };
          currentThinkingSignature = '';
        } else if (currentBlockType === 'tool_use') {
          yield { type: 'tool_call_stop' };
        }
        currentBlockType = 'text';
        yield { type: 'text_start' };
      }

      yield {
        type: 'text_delta',
        text: sourcesMarkdown
      };
    }
  }

  // Ensure active block stopped
  if (currentBlockType === 'thinking') {
    yield { type: 'thinking_stop', signature: currentThinkingSignature || undefined };
  } else if (currentBlockType === 'text') {
    yield { type: 'text_stop' };
  }

  yield {
    type: 'finish',
    stopReason: hasToolCalls ? 'tool_use' : stopReason,
    inputTokens,
    outputTokens,
    cacheReadTokens
  };
}

/**
 * Parses Google Cloud Code PA SSE stream into Anthropic SSE Events
 */
export async function* parseGoogleStreamToAnthropic(
  stream: ReadableStream<Uint8Array>,
  model: string,
  tools?: ToolDefinitionLike[]
): AsyncGenerator<AnthropicEvent> {
  yield* toAnthropicEventStream(
    parseGoogleStreamToUnified(stream, model, tools),
    model
  );
}

/**
 * Parses Google Cloud Code PA SSE stream into OpenAI Chat Completion Chunks
 */
export async function* parseGoogleStreamToOpenAI(
  stream: ReadableStream<Uint8Array>,
  model: string,
  tools?: ToolDefinitionLike[]
): AsyncGenerator<OpenAIChatChunk> {
  yield* toOpenAIChatChunkStream(
    parseGoogleStreamToUnified(stream, model, tools),
    model
  );
}
