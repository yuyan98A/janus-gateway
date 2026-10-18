import crypto from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Dispatcher } from '../router/dispatcher.ts';
import type { AnthropicRequest, AnthropicResponse, AnthropicContentPart } from '../types.ts';
import { initSSEResponse, writeSSE, endSSE } from '../utils/sse.ts';
import { logTrace, serializeError } from '../utils/logger.ts';

export async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  dispatcher: Dispatcher,
  body: AnthropicRequest
) {
  if (!body || !body.model || !body.messages) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Missing model or messages' } }));
    return;
  }

  let prepared;
  try {
    prepared = typeof dispatcher.prepareAnthropicReasoning === 'function'
      ? await dispatcher.prepareAnthropicReasoning(body)
      : (dispatcher.validateAnthropicReasoning(body), undefined);
  } catch (err: any) {
    res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: err.message } }));
    return;
  }

  const abortController = new AbortController();
  const onAborted = () => {
    abortController.abort();
  };
  req.on('aborted', onAborted);
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  const isStreaming = body.stream !== false;

  if (isStreaming) {
    const generator = dispatcher.dispatchAnthropic(body, prepared, { signal: abortController.signal });

    try {
      // First-chunk buffering strategy:
      // Await the first event before flushing HTTP headers.
      // If this throws (e.g. upstream 401, 429, 503, invalid model), we can safely respond with an HTTP error JSON.
      const firstResult = await generator.next();

      initSSEResponse(res);
      await logTrace('ingress.stream_started', { protocol: 'anthropic-messages', model: body.model });

      if (!firstResult.done && firstResult.value) {
        await logTrace('ingress.response_event', { protocol: 'anthropic-messages', payload: firstResult.value });
        writeSSE(res, firstResult.value.type, firstResult.value);
      }

      for await (const event of generator) {
        if (abortController.signal.aborted) break;
        await logTrace('ingress.response_event', { protocol: 'anthropic-messages', payload: event });
        writeSSE(res, event.type, event);
      }
      endSSE(res);
      await logTrace('ingress.stream_completed', { protocol: 'anthropic-messages', model: body.model });
    } catch (err: any) {
      await logTrace('ingress.error', {
        protocol: 'anthropic-messages',
        model: body.model,
        streaming: true,
        error: serializeError(err)
      });

      if (!res.headersSent) {
        const statusCode = err.statusCode || (typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            type: err.type || (statusCode === 429 ? 'rate_limit_error' : statusCode === 401 ? 'authentication_error' : 'api_error'),
            message: err.message || 'Stream processing failed'
          }
        }));
      } else {
        writeSSE(res, 'error', {
          type: 'error',
          error: {
            type: 'api_error',
            message: err.message || 'Stream processing failed'
          }
        });
        endSSE(res);
      }
    } finally {
      req.off('aborted', onAborted);
    }
  } else {
    // Non-streaming response aggregation
    try {
      let finalResponse: AnthropicResponse | null = null;
      let outputTokens = 0;
      let stopReason: AnthropicResponse['stop_reason'] = null;
      let stopSequence: string | null = null;
      let accumulatedText = '';

      interface BlockState {
        type: 'text' | 'thinking' | 'tool_use';
        id?: string;
        name?: string;
        text?: string;
        thinking?: string;
        signature?: string;
        partialJson?: string;
      }
      const blocks: BlockState[] = [];

      for await (const event of dispatcher.dispatchAnthropic(body, prepared, { signal: abortController.signal })) {
        if (event.type === 'message_start') {
          finalResponse = event.message;
          outputTokens = event.message.usage?.output_tokens ?? outputTokens;
        } else if (event.type === 'content_block_start') {
          const idx = event.index;
          const cb = event.content_block;
          const blockType = (cb?.type || 'text') as BlockState['type'];
          blocks[idx] = {
            type: blockType,
            id: cb?.id,
            name: cb?.name,
            text: cb?.text || '',
            thinking: cb?.thinking || '',
            signature: cb?.signature,
            partialJson: ''
          };
        } else if (event.type === 'content_block_delta') {
          const idx = event.index;
          if (!blocks[idx]) {
            let inferredType: BlockState['type'] = 'text';
            if (event.delta.type === 'thinking_delta') inferredType = 'thinking';
            else if (event.delta.type === 'input_json_delta') inferredType = 'tool_use';
            blocks[idx] = { type: inferredType, text: '', thinking: '', partialJson: '' };
          }
          const block = blocks[idx];
          if (event.delta.type === 'text_delta' && event.delta.text) {
            block.text = (block.text || '') + event.delta.text;
            accumulatedText += event.delta.text;
          } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            block.thinking = (block.thinking || '') + event.delta.thinking;
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            block.partialJson = (block.partialJson || '') + event.delta.partial_json;
          } else if (event.delta.type === 'signature_delta' && event.delta.signature) {
            block.signature = (block.signature || '') + event.delta.signature;
          }
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          if (event.delta.stop_reason) {
            stopReason = event.delta.stop_reason as AnthropicResponse['stop_reason'];
          }
          if (event.delta.stop_sequence) {
            stopSequence = event.delta.stop_sequence;
          }
        }
      }

      if (finalResponse) {
        const contentParts: AnthropicContentPart[] = [];
        for (const b of blocks) {
          if (!b) continue;
          if (b.type === 'thinking') {
            contentParts.push({
              type: 'thinking',
              thinking: b.thinking || '',
              ...(b.signature ? { signature: b.signature } : {})
            });
          } else if (b.type === 'tool_use') {
            let input: Record<string, any> = {};
            if (b.partialJson) {
              try {
                input = JSON.parse(b.partialJson);
              } catch {
                input = { raw: b.partialJson };
              }
            }
            contentParts.push({
              type: 'tool_use',
              id: b.id || `toolu_${crypto.randomUUID().replace(/-/g, '')}`,
              name: b.name || '',
              input
            });
          } else {
            contentParts.push({
              type: 'text',
              text: b.text || ''
            });
          }
        }

        if (contentParts.length === 0 && accumulatedText) {
          contentParts.push({ type: 'text', text: accumulatedText });
        }

        finalResponse.content = contentParts;
        finalResponse.usage.output_tokens = outputTokens;
        finalResponse.stop_reason = stopReason;
        finalResponse.stop_sequence = stopSequence;
        await logTrace('ingress.response_body', { protocol: 'anthropic-messages', body: finalResponse });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(finalResponse));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'No response generated from upstream' } }));
      }
    } catch (err: any) {
      await logTrace('ingress.error', {
        protocol: 'anthropic-messages',
        model: body.model,
        streaming: false,
        error: serializeError(err)
      });
      res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'api_error', message: err.message } }));
    } finally {
      req.off('aborted', onAborted);
    }
  }
}


