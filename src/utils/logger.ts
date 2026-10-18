import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyRequestLogEvent,
  createRequestAccumulator,
  finalizeRequestSummary,
  requestAnalytics,
  type RequestAccumulator
} from './request-analytics.ts';

interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  summary: RequestAccumulator;
}

const contextStorage = new AsyncLocalStorage<RequestLogContext>();
const requestContextByMessage = new WeakMap<IncomingMessage, RequestLogContext>();
let writeQueue = Promise.resolve();

async function appendWithRetry(filePath: string, line: string): Promise<void> {
  const retryDelaysMs = [50, 100, 250, 500, 1000, 2000];
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, line, 'utf8');
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const delayMs = retryDelaysMs[attempt];
      if (!delayMs || !['EBUSY', 'EPERM', 'EACCES'].includes(code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

function logFilePath(timestamp: string): string {
  const date = timestamp.slice(0, 10);
  return path.join(process.cwd(), 'logs', `gateway-${date}.jsonl`);
}

function summarizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ['provider', 'model', 'upstreamModel', 'status', 'statusCode', 'durationMs', 'stream', 'error']) {
    if (details[key] !== undefined) summary[key] = details[key];
  }
  return summary;
}

function writeTrace(
  event: string,
  details: Record<string, unknown>,
  context: RequestLogContext | undefined
): Promise<void> {
  const timestamp = new Date().toISOString();
  const record = {
    timestamp,
    requestId: context?.requestId ?? null,
    method: context?.method,
    path: context?.path,
    ...details,
    event
  };
  if (context) applyRequestLogEvent(context.summary, event, record);
  const line = `${JSON.stringify(record)}\n`;
  const filePath = logFilePath(timestamp);

  writeQueue = writeQueue
    .then(() => appendWithRetry(filePath, line))
    .catch(error => {
      console.error('[GatewayLogger] Failed to write trace:', error instanceof Error ? error.message : String(error));
    });

  const consoleRecord = {
    timestamp,
    requestId: record.requestId,
    event,
    ...summarizeDetails(details)
  };
  console.info(`[Gateway] ${JSON.stringify(consoleRecord)}`);
  return writeQueue;
}

export function logTrace(event: string, details: Record<string, unknown> = {}): Promise<void> {
  return writeTrace(event, details, contextStorage.getStore());
}

export function logRequestTrace(
  req: IncomingMessage,
  event: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  return writeTrace(event, details, contextStorage.getStore() ?? requestContextByMessage.get(req));
}

export async function withRequestLog<T>(
  req: IncomingMessage,
  res: ServerResponse,
  handler: () => Promise<T>
): Promise<T> {
  const suppliedId = req.headers['x-request-id'];
  const requestId = typeof suppliedId === 'string' && /^[\w.:-]{1,128}$/.test(suppliedId)
    ? suppliedId
    : randomUUID();
  const requestPath = (req.url || '/').split('?')[0];
  const context: RequestLogContext = {
    requestId,
    method: req.method || 'UNKNOWN',
    path: requestPath,
    startedAt: Date.now(),
    summary: createRequestAccumulator({
      requestId,
      timestamp: new Date().toISOString(),
      method: req.method || 'UNKNOWN',
      path: requestPath
    })
  };

  requestContextByMessage.set(req, context);
  res.setHeader('x-request-id', requestId);
  return contextStorage.run(context, async () => {
    const finishAndIndex = (event: string, details: Record<string, unknown>) => {
      void writeTrace(event, {
        ...details,
        responseHeaders: event === 'http.response' ? res.getHeaders() : undefined
      }, context).then(() => requestAnalytics.record(finalizeRequestSummary(context.summary)))
        .catch(error => console.error('[GatewayLogger] Failed to index request:', error instanceof Error ? error.message : String(error)));
    };
    res.once('finish', () => {
      finishAndIndex('http.response', {
        statusCode: res.statusCode,
        durationMs: Date.now() - context.startedAt
      });
    });
    res.once('close', () => {
      if (!res.writableFinished) {
        finishAndIndex('http.client_disconnected', {
          statusCode: res.statusCode,
          durationMs: Date.now() - context.startedAt
        });
      }
    });
    await logTrace('http.request', {
      headers: req.headers
    });
    try {
      return await handler();
    } catch (error) {
      await logTrace('http.unhandled_error', { error: serializeError(error) });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
      return undefined as T;
    }
  });
}

export async function captureReadableStream(
  stream: ReadableStream<Uint8Array>,
  label: string
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    await logTrace('stream.complete', {
      label,
      chunkCount: chunks.length,
      rawBody: chunks.join('')
    });
  } catch (error) {
    await logTrace('stream.capture_error', {
      label,
      error: serializeError(error)
    });
  } finally {
    reader.releaseLock();
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const extended = error as Error & { code?: string; statusCode?: number; cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(extended.code ? { code: extended.code } : {}),
      ...(extended.statusCode ? { statusCode: extended.statusCode } : {}),
      ...(extended.cause ? { cause: String(extended.cause) } : {})
    };
  }
  return { value: String(error) };
}
