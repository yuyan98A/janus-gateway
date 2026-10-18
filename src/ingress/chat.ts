import crypto from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Dispatcher } from '../router/dispatcher.ts';
import type { OpenAIChatRequest, OpenAIChatResponse, OpenAIChatMessage } from '../types.ts';
import { initSSEResponse, writeSSE, endSSE } from '../utils/sse.ts';
import { logTrace, serializeError } from '../utils/logger.ts';

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  dispatcher: Dispatcher,
  body: OpenAIChatRequest
) {
  if (!body || !body.model || !body.messages) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Missing model or messages in request body' } }));
    return;
  }

  let prepared;
  try {
    prepared = typeof dispatcher.prepareOpenAIReasoning === 'function'
      ? await dispatcher.prepareOpenAIReasoning(body)
      : (dispatcher.validateOpenAIReasoning(body), undefined);
  } catch (err: any) {
    res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message } }));
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
    const generator = dispatcher.dispatchOpenAI(body, { prepared, signal: abortController.signal });

    try {
      // First-chunk buffering strategy:
      // Await first chunk before flushing HTTP headers.
      // If this throws (e.g. upstream 401, 429, 503, invalid model), we can safely respond with an HTTP error JSON.
      const firstResult = await generator.next();

      initSSEResponse(res);
      await logTrace('ingress.stream_started', { protocol: 'openai-chat-completions', model: body.model });

      if (!firstResult.done && firstResult.value) {
        await logTrace('ingress.response_event', { protocol: 'openai-chat-completions', payload: firstResult.value });
        writeSSE(res, null, firstResult.value);
      }

      for await (const chunk of generator) {
        if (abortController.signal.aborted) break;
        await logTrace('ingress.response_event', { protocol: 'openai-chat-completions', payload: chunk });
        writeSSE(res, null, chunk);
      }
      endSSE(res, true); // send [DONE]
      await logTrace('ingress.stream_completed', { protocol: 'openai-chat-completions', model: body.model });
    } catch (err: any) {
      await logTrace('ingress.error', {
        protocol: 'openai-chat-completions',
        model: body.model,
        streaming: true,
        error: serializeError(err)
      });

      if (!res.headersSent) {
        const statusCode = err.statusCode || (typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: err.message || 'Stream processing failed',
            type: statusCode === 429 ? 'rate_limit_error' : 'server_error'
          }
        }));
      } else {
        writeSSE(res, null, {
          error: {
            message: err.message || 'Stream processing failed',
            type: 'server_error'
          }
        });
        endSSE(res, true);
      }
    } finally {
      req.off('aborted', onAborted);
    }
  } else {
    // Non-streaming aggregation
    try {
      let accumulatedText = '';
      let hasContent = false;
      let accumulatedReasoning = '';
      let hasReasoning = false;
      let id = '';
      let model = body.model;
      let created = Math.floor(Date.now() / 1000);
      let finishReason: any = null;
      let inputTokens = 0;
      let outputTokens = 0;

      interface ToolCallState {
        id: string;
        name: string;
        arguments: string;
      }
      const toolCallsMap = new Map<number, ToolCallState>();

      for await (const chunk of dispatcher.dispatchOpenAI(body, { prepared, signal: abortController.signal })) {
        if (!id && chunk.id) id = chunk.id;
        if (chunk.model) model = chunk.model;
        if (chunk.created) created = chunk.created;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || inputTokens;
          outputTokens = chunk.usage.completion_tokens || outputTokens;
        }
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          accumulatedText += choice.delta.content;
          hasContent = true;
        }
        if (choice?.delta?.reasoning_content) {
          accumulatedReasoning += choice.delta.reasoning_content;
          hasReasoning = true;
        }
        if (choice?.delta?.tool_calls && Array.isArray(choice.delta.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsMap.get(idx) || { id: '', name: '', arguments: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolCallsMap.set(idx, existing);
          }
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      const toolCalls = Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => ({
          id: tc.id || `call_${crypto.randomUUID().replace(/-/g, '')}`,
          type: 'function' as const,
          function: {
            name: tc.name || '',
            arguments: tc.arguments || ''
          }
        }));

      const hasToolCalls = toolCalls.length > 0;
      if (!finishReason) {
        finishReason = hasToolCalls ? 'tool_calls' : 'stop';
      }

      const message: OpenAIChatMessage = {
        role: 'assistant',
        content: hasContent ? accumulatedText : (hasToolCalls ? undefined : '')
      };

      if (hasReasoning) {
        message.reasoning_content = accumulatedReasoning;
      }

      if (hasToolCalls) {
        message.tool_calls = toolCalls;
      }

      const response: OpenAIChatResponse = {
        id: id || `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message,
            finish_reason: finishReason
          }
        ],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        }
      };

      await logTrace('ingress.response_body', { protocol: 'openai-chat-completions', body: response });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err: any) {
      await logTrace('ingress.error', {
        protocol: 'openai-chat-completions',
        model: body.model,
        streaming: false,
        error: serializeError(err)
      });
      res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    } finally {
      req.off('aborted', onAborted);
    }
  }
}


