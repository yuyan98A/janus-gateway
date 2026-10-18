import http from 'node:http';
import type { GatewayConfig } from '../types.ts';
import type { Dispatcher } from '../router/dispatcher.ts';

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function handleCodexStatus(
  res: http.ServerResponse,
  config: GatewayConfig,
  dispatcher: Dispatcher
): void {
  if (!config.providers.codex.enabled) {
    sendJson(res, 200, { enabled: false, auth: null, lastConnectionCheck: null });
    return;
  }
  const status = dispatcher.getCodexAccountStatus();
  sendJson(res, 200, { enabled: true, ...status });
}

export async function handleCodexUsageRefresh(
  res: http.ServerResponse,
  config: GatewayConfig,
  dispatcher: Dispatcher
): Promise<void> {
  if (!config.providers.codex.enabled) {
    sendJson(res, 200, {
      object: 'codex_usage',
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
      error: 'Codex 专线已停用'
    });
    return;
  }

  const usage = await dispatcher.refreshCodexUsage();
  sendJson(res, 200, { object: 'codex_usage', ...usage });
}

export async function handleCodexConnectionCheck(
  res: http.ServerResponse,
  body: any,
  dispatcher: Dispatcher
): Promise<void> {
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-6.1-sol';
  if (dispatcher.resolveProvider(model) !== 'codex') {
    sendJson(res, 400, { error: { message: `Model '${model}' is not routed to the Codex provider` } });
    return;
  }

  const result = await dispatcher.checkCodexConnection(model);
  sendJson(res, 200, { object: 'codex_connection_check', ...result });
}
