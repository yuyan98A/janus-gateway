import { ServerResponse } from 'node:http';

/**
 * Format SSE event string
 */
export function formatSSE(event: string | null, data: any): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  if (event) {
    return `event: ${event}\ndata: ${payload}\n\n`;
  }
  return `data: ${payload}\n\n`;
}

/**
 * Initialize HTTP response for SSE streaming
 */
export function initSSEResponse(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*'
  });
}

/**
 * Write SSE chunk safely to response
 */
export function writeSSE(res: ServerResponse, event: string | null, data: any) {
  if (res.writableEnded) return;
  res.write(formatSSE(event, data));
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
}

/**
 * End SSE stream with optional [DONE]
 */
export function endSSE(res: ServerResponse, sendDone = false) {
  if (res.writableEnded) return;
  if (sendDone) {
    res.write('data: [DONE]\n\n');
  }
  res.end();
}
