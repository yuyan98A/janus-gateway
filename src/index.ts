import http from 'node:http';
import cluster from 'node:cluster';
import { loadConfig } from './config.ts';
import { Dispatcher } from './router/dispatcher.ts';
import { handleHealth } from './ingress/health.ts';
import { handleModels } from './ingress/models.ts';
import { handleModelTest } from './ingress/model-test.ts';
import { handleReasoningProbe } from './ingress/reasoning-probe.ts';
import { handleReasoningProfileSave } from './ingress/reasoning-profile.ts';
import { handleCodexStatus, handleCodexConnectionCheck, handleCodexUsageRefresh } from './ingress/codex-status.ts';
import { handleMessages } from './ingress/messages.ts';
import { handleChat } from './ingress/chat.ts';
import { handleAdminGoogleAccounts, handleGoogleQuota } from './ingress/admin.ts';
import { handleWeb } from './ingress/web.ts';
import { handleRequestLogs } from './ingress/request-logs.ts';
import { logRequestTrace, logTrace, serializeError, withRequestLog } from './utils/logger.ts';
import { requestAnalytics } from './utils/request-analytics.ts';
import { drainTracker } from './utils/drain.ts';

const config = loadConfig();
const dispatcher = new Dispatcher(config);
const dashboardPaths = new Set([
  '/', '/web', '/usage', '/requests', '/google-accounts', '/codex', '/models', '/playground', '/connect'
]);
void requestAnalytics.initialize().catch(error => {
  console.error('[RequestAnalytics] Historical log indexing failed:', error instanceof Error ? error.message : String(error));
});

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      // 50MB limit safeguard
      if (raw.length > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', async () => {
      if (!raw.trim()) {
        await logRequestTrace(req, 'http.request_body', { rawBody: raw, parsedBody: {} });
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        await logRequestTrace(req, 'http.request_body', { rawBody: raw, parsedBody: parsed });
        resolve(parsed);
      } catch (err: any) {
        await logRequestTrace(req, 'http.request_body_parse_error', {
          rawBody: raw,
          error: serializeError(err)
        });
        reject(new Error(`Invalid JSON: ${err.message}`));
      }
    });
    req.on('error', err => reject(err));
  });
}

function checkAuth(req: http.IncomingMessage, configuredApiKey: string): boolean {
  if (!configuredApiKey) return true; // No key configured = allow all

  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === configuredApiKey) return true;
  }

  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && String(xApiKey).trim() === configuredApiKey) {
    return true;
  }

  return false;
}

const server = http.createServer((req, res) => withRequestLog(req, res, async () => {
  drainTracker.track(req, res);
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. Health & reachability probe endpoints (no auth required)
  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  const isProbePath =
    pathname === '/health' ||
    pathname === '/api/hello' ||
    pathname === '/ping' ||
    pathname === '/v1/health';

  if ((req.method === 'GET' || req.method === 'HEAD') && isProbePath) {
    if (pathname === '/api/hello' || pathname === '/ping') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(JSON.stringify({ status: 'ok', message: 'hello', timestamp: new Date().toISOString() }));
      }
      return;
    }
    await handleHealth(req, res, config);
    return;
  }

  // 2. Web UI dashboard pages (no auth required for the page shell)
  if ((req.method === 'GET' || req.method === 'HEAD') && dashboardPaths.has(pathname)) {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }
    await handleWeb(req, res, config, dispatcher);
    return;
  }

  // 3. Auth verification for API endpoints
  if (config.server.apiKey && !checkAuth(req, config.server.apiKey)) {
    await logTrace('http.authentication_failed', {
      authorization: req.headers.authorization,
      apiKey: req.headers['x-api-key']
    });
    if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      console.warn(
        `[Ingress:Models] Rejected unauthorized model-list request: path=${pathname}, ` +
        `authorization=${Boolean(req.headers.authorization)}, x-api-key=${Boolean(req.headers['x-api-key'])}`
      );
    }
    // If not matching our gateway key, allow passing through if it's an upstream key
    // But if apiKey is strictly set, reject with 401
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Unauthorized: Invalid API Key' } }));
    return;
  }

  if (pathname === '/v1/admin/requests' || pathname === '/v1/admin/requests/summary' || pathname.startsWith('/v1/admin/requests/')) {
    await handleRequestLogs(req, res, pathname, url.searchParams);
    return;
  }

  // 3. Models endpoint
  if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
    console.info(`[Ingress:Models] Received model-list request: path=${pathname}`);
    await handleModels(req, res, dispatcher);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/models/test') {
    try {
      const body = await readJsonBody(req);
      await handleModelTest(res, dispatcher, body);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/models/refresh') {
    try {
      let body: any = {};
      try { body = await readJsonBody(req); } catch { /* ignore empty body */ }
      const provider = body?.provider || 'all';
      const result = await dispatcher.refreshModels(provider);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'model_discovery_refresh',
        provider,
        ...result
      }));
    } catch (err: any) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/models/reasoning-probe') {
    try {
      const body = await readJsonBody(req);
      await handleReasoningProbe(res, dispatcher, body);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (req.method === 'PUT' && pathname === '/v1/admin/models/reasoning-profile') {
    try {
      const body = await readJsonBody(req);
      await handleReasoningProfileSave(res, body, config, dispatcher);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/codex/status') {
    handleCodexStatus(res, config, dispatcher);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/codex/usage') {
    await handleCodexUsageRefresh(res, config, dispatcher);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/codex/status/check') {
    try {
      const body = await readJsonBody(req);
      await handleCodexConnectionCheck(res, body, dispatcher);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // 4. Anthropic Messages endpoint
  if (req.method === 'POST' && (pathname === '/v1/messages' || pathname === '/messages')) {
    try {
      const body = await readJsonBody(req);
      await handleMessages(req, res, dispatcher, body);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // 5. OpenAI Chat Completions endpoint
  if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
    try {
      const body = await readJsonBody(req);
      await handleChat(req, res, dispatcher, body);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // 6. Admin Google Accounts & Quota endpoint
  if (req.method === 'GET' && pathname === '/v1/admin/google/quota') {
    const accountId = url.searchParams.get('accountId') || url.searchParams.get('account') || undefined;
    await handleGoogleQuota(req, res, dispatcher, accountId);
    return;
  }

  if (pathname.startsWith('/v1/admin/google/accounts')) {
    try {
      const body = (req.method === 'POST' || req.method === 'PATCH') ? await readJsonBody(req) : undefined;
      await handleAdminGoogleAccounts(req, res, dispatcher, pathname, body, config.server.port);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/gateway/upgrade') {
    if (cluster.isWorker) {
      process.send?.({ type: 'request_upgrade' });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'upgrading',
        message: 'Rolling zero-downtime upgrade signal sent to cluster master',
        workerPid: process.pid,
        inFlightRequests: drainTracker.getInFlightCount()
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'standalone',
        message: 'Gateway is running in standalone mode. To enable multi-process rolling upgrades, launch with npm run start:cluster',
        workerPid: process.pid,
        inFlightRequests: drainTracker.getInFlightCount()
      }));
    }
    return;
  }

  // 404 Catch-all
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `Route ${req.method} ${pathname} not found` } }));
}));

const PORT = config.server.port;
const HOST = config.server.host;

server.listen(PORT, HOST, () => {
  const isWorker = cluster.isWorker;
  console.log('='.repeat(70));
  console.log(`🚀 Virtual Model Gateway is running on http://${HOST}:${PORT} [PID ${process.pid}${isWorker ? ' (Cluster Worker)' : ''}]`);
  console.log(`   - Web 控制台 (Dashboard) : http://${HOST}:${PORT}/`);
  console.log(`   - Anthropic Endpoint      : http://${HOST}:${PORT}/v1/messages`);
  console.log(`   - OpenAI Endpoint    : http://${HOST}:${PORT}/v1/chat/completions`);
  console.log(`   - Models Endpoint    : http://${HOST}:${PORT}/v1/models`);
  console.log(`   - Model Test API     : POST http://${HOST}:${PORT}/v1/admin/models/test`);
  console.log(`   - Health Endpoint    : http://${HOST}:${PORT}/health`);
  console.log(`   - Upgrade API        : POST http://${HOST}:${PORT}/v1/admin/gateway/upgrade`);
  console.log(`   - Google Provider    : ${config.providers.google.enabled ? 'ACTIVE' : 'DISABLED'}`);
  console.log(`   - Codex Provider     : ${config.providers.codex?.enabled ? 'ACTIVE' : 'DISABLED'}`);
  console.log('='.repeat(70));

  // Notify Cluster Master that worker is ready to handle traffic
  if (isWorker && process.send) {
    process.send({ type: 'ready', pid: process.pid, port: PORT });
  }
});

// Cluster Worker IPC message listener
if (cluster.isWorker) {
  process.on('message', async (msg: any) => {
    if (msg?.type === 'drain') {
      console.log(`[Worker ${process.pid}] Received drain signal from master. In-flight requests: ${drainTracker.getInFlightCount()}`);
      const result = await drainTracker.startGracefulDrain(server, { timeoutMs: 120000 });
      console.log(`[Worker ${process.pid}] Drain finished (clean: ${result.drainedCleanly}). Exiting.`);
      process.exit(0);
    }
  });
}

// Graceful shutdown
let isShuttingDown = false;
async function shutdown() {
  if (isShuttingDown) {
    console.log('[Gateway] Force exit requested.');
    process.exit(1);
  }
  isShuttingDown = true;
  console.log(`\n[Gateway] Graceful shutdown initiated. Active in-flight requests: ${drainTracker.getInFlightCount()}`);
  const result = await drainTracker.startGracefulDrain(server, { timeoutMs: 30000 });
  console.log(`[Gateway] Server drained cleanly: ${result.drainedCleanly}. Exiting.`);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason) => {
  console.warn('[Gateway] Unhandled promise rejection (non-fatal):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Gateway] Uncaught exception:', err);
});


