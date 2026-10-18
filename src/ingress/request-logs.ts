import http from 'node:http';
import { requestAnalytics } from '../utils/request-analytics.ts';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function handleRequestLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  searchParams: URLSearchParams
): Promise<void> {
  try {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { message: 'Method not allowed' } });
      return;
    }

    if (pathname === '/v1/admin/requests/summary') {
      sendJson(res, 200, await requestAnalytics.summary(searchParams.get('from'), searchParams.get('to')));
      return;
    }

    if (pathname === '/v1/admin/requests') {
      sendJson(res, 200, await requestAnalytics.list({
        from: searchParams.get('from'),
        to: searchParams.get('to'),
        requestId: searchParams.get('requestId') || undefined,
        model: searchParams.get('model') || undefined,
        provider: searchParams.get('provider') || undefined,
        result: searchParams.get('result') || undefined,
        limit: Number(searchParams.get('limit')) || 50,
        offset: Number(searchParams.get('offset')) || 0
      }));
      return;
    }

    const requestId = decodeURIComponent(pathname.slice('/v1/admin/requests/'.length));
    if (!requestId || requestId.includes('/')) {
      sendJson(res, 400, { error: { message: 'Invalid request ID' } });
      return;
    }
    const details = await requestAnalytics.details(requestId);
    if (!details.summary) {
      sendJson(res, 404, { error: { message: 'Request not found in indexed logs' } });
      return;
    }
    sendJson(res, 200, details);
  } catch (error) {
    sendJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
}
