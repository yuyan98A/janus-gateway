import http from 'node:http';
import { loadConfig } from '../src/config.ts';
import { Dispatcher } from '../src/router/dispatcher.ts';
import { handleHealth } from '../src/ingress/health.ts';
import { handleModels } from '../src/ingress/models.ts';
import { handleMessages } from '../src/ingress/messages.ts';
import { handleChat } from '../src/ingress/chat.ts';
import { handleAdminGoogleAccounts, handleGoogleQuota } from '../src/ingress/admin.ts';
import { handleWeb } from '../src/ingress/web.ts';

const TEST_GATEWAY_PORT = 9100;
const TEST_API_KEY = 'sk-gateway-test-secret';

// ======================== Step 2: Start Test Gateway Server ========================
const testConfig = loadConfig();
testConfig.server.port = TEST_GATEWAY_PORT;
testConfig.server.apiKey = TEST_API_KEY;

const dispatcher = new Dispatcher(testConfig);

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
    req.on('error', err => reject(err));
  });
}

const gatewayServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

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
    await handleHealth(req, res, testConfig);
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/web')) {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end();
      return;
    }
    await handleWeb(req, res, testConfig, dispatcher);
    return;
  }

  // Auth check
  const auth = req.headers['authorization'] || req.headers['x-api-key'];
  const token = auth ? String(auth).replace(/^Bearer\s+/i, '').trim() : '';
  if (token !== TEST_API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/models') {
    await handleModels(req, res, dispatcher);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/messages') {
    const body = await readJsonBody(req);
    await handleMessages(req, res, dispatcher, body);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    const body = await readJsonBody(req);
    await handleChat(req, res, dispatcher, body);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/models/refresh') {
    try {
      const body = await readJsonBody(req);
      const result = await dispatcher.refreshModels(body?.provider || 'all');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/google/quota') {
    const accountId = url.searchParams.get('accountId') || url.searchParams.get('account') || undefined;
    await handleGoogleQuota(req, res, dispatcher, accountId);
    return;
  }

  if (pathname.startsWith('/v1/admin/google/accounts')) {
    try {
      const body = (req.method === 'POST' || req.method === 'PATCH') ? await readJsonBody(req) : undefined;
      await handleAdminGoogleAccounts(req, res, dispatcher, pathname, body);
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

// ======================== Step 3: Test Runner ========================
async function runTests() {
  console.log('='.repeat(70));
  console.log('🧪 Starting Virtual Model Gateway MVP Automated Verification Suite');
  console.log('='.repeat(70));

  await new Promise(r => gatewayServer.listen(TEST_GATEWAY_PORT, r));
  console.log(`[Test] Gateway listening on ${TEST_GATEWAY_PORT}\n`);

  let passed = 0;
  let failed = 0;

  async function assertTest(name: string, fn: () => Promise<void>) {
    process.stdout.write(`• Testing [${name}] ... `);
    const start = Date.now();
    try {
      await fn();
      const elapsed = Date.now() - start;
      console.log(`\x1b[32mPASSED\x1b[0m (${elapsed}ms)`);
      passed++;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      console.log(`\x1b[31mFAILED\x1b[0m (${elapsed}ms): ${err.message}`);
      failed++;
    }
  }

  // ---------------- Test 1: Health & Probes ----------------
  await assertTest('GET /health (No auth required)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/health`);
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(`Unexpected data: ${JSON.stringify(data)}`);
  });

  await assertTest('HEAD /api/hello (Probe reachability without auth)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/api/hello`, { method: 'HEAD' });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
  });

  await assertTest('GET /api/hello (Probe reachability without auth)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/api/hello`);
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(`Unexpected data: ${JSON.stringify(data)}`);
  });

  await assertTest('HEAD / (Root reachability without auth)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/`, { method: 'HEAD' });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
  });

  // ---------------- Test 2: Auth Rejection ----------------
  await assertTest('GET /v1/models (Unauthorized rejection)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/models`, {
      headers: { 'Authorization': 'Bearer wrong-key' }
    });
    if (resp.status !== 401) throw new Error(`Expected 401, got ${resp.status}`);
  });

  // ---------------- Test 3: Models Listing ----------------
  await assertTest('GET /v1/models (Authorized with Bearer token, categories assigned)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/models`, {
      headers: { 'Authorization': `Bearer ${TEST_API_KEY}` }
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Model list is empty');
    }
    const modelIds = data.data.map((m: any) => m.id);
    if (!modelIds.includes('claude-sonnet-4-6') || !modelIds.includes('gpt-6.1-sol')) {
      throw new Error(`Missing expected models. Got: ${modelIds.join(', ')}`);
    }
    // Verify categories are present and valid
    for (const model of data.data) {
      if (!model.category) {
        throw new Error(`Model ${model.id} is missing category property`);
      }
    }
  });

  // ---------------- Test 3b: Model Manual Refresh & Diff Reporting ----------------
  await assertTest('POST /v1/admin/models/refresh (Manual refresh & diff report)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/admin/models/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ provider: 'all' })
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (typeof data.updated !== 'boolean' || !data.updatedAt || !data.changes || !data.summary) {
      throw new Error(`Unexpected refresh response: ${JSON.stringify(data)}`);
    }
  });

  // ---------------- Test 3c: Strict Routing (No Heuristic Prefix/Keyword Matching) ----------------
  await assertTest('Router: Strict routing without keyword/prefix heuristics', async () => {
    // 1. Explicit routes work
    if (dispatcher.resolveProvider('claude-sonnet-4-6') !== 'google') {
      throw new Error('Expected claude-sonnet-4-6 to resolve to google');
    }
    if (dispatcher.resolveProvider('gpt-6.1-sol') !== 'codex') {
      throw new Error('Expected gpt-6.1-sol to resolve to codex');
    }

    // 2. Unknown models with keywords like claude or gpt must NOT match heuristically
    let errorCaughtClaude = false;
    try {
      dispatcher.resolveProvider('claude-nonexistent-synthetic-model');
    } catch {
      errorCaughtClaude = true;
    }
    if (!errorCaughtClaude) {
      throw new Error('Heuristic keyword matching still routed unknown claude model');
    }

    let errorCaughtGpt = false;
    try {
      dispatcher.resolveProvider('gpt-nonexistent-synthetic-model');
    } catch {
      errorCaughtGpt = true;
    }
    if (!errorCaughtGpt) {
      throw new Error('Heuristic keyword matching still routed unknown gpt model');
    }
  });

  // ---------------- Test 7: Live Google Antigravity Provider via /v1/messages ----------------
  await assertTest('Live Google Antigravity via Anthropic /v1/messages (claude-sonnet-4-6)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEST_API_KEY
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Reply with the single word: "PONG_SONNET"' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const text = await resp.text();
    if (!text.includes('message_start') || !text.includes('content_block_delta')) {
      throw new Error(`Expected Anthropic SSE stream from Google. Got:\n${text.slice(0, 300)}`);
    }
  });

  // ---------------- Test 8: Live Google Antigravity Provider via OpenAI /v1/chat/completions ----------------
  await assertTest('Live Google Antigravity via OpenAI /v1/chat/completions (claude-sonnet-4-6)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Reply with: "OPENAI_TO_GOOGLE_OK"' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const text = await resp.text();
    if (!text.includes('chat.completion.chunk') || !text.includes('[DONE]')) {
      throw new Error(`Expected OpenAI Chat chunks from Google PA. Got:\n${text.slice(0, 300)}`);
    }
  });

  // ---------------- Test 9: Live Google Antigravity Gemini Flash ----------------
  await assertTest('Live Google Antigravity via Anthropic /v1/messages (gemini-2.5-flash)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEST_API_KEY
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        max_tokens: 30,
        messages: [{ role: 'user', content: 'Ping' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const text = await resp.text();
    if (!text.includes('message_start') || !text.includes('content_block_delta')) {
      throw new Error(`Expected Anthropic SSE stream from Google. Got:\n${text.slice(0, 300)}`);
    }
  });

  // ---------------- Test 10: Live Codex Provider via Anthropic /v1/messages (gpt-6.1-sol) ----------------
  await assertTest('Live Codex Provider via Anthropic /v1/messages (gpt-6.1-sol)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEST_API_KEY
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        max_tokens: 40,
        messages: [{ role: 'user', content: 'Reply with the single word: "PONG_CODEX"' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const text = await resp.text();
    if (!text.includes('message_start') || !text.includes('content_block_delta') || !text.includes('message_stop')) {
      throw new Error(`Expected Anthropic SSE stream from Codex. Got:\n${text.slice(0, 300)}`);
    }
  });

  // ---------------- Test 11: Live Codex Provider via OpenAI /v1/chat/completions (gpt-6.1-sol) ----------------
  await assertTest('Live Codex Provider via OpenAI /v1/chat/completions (gpt-6.1-sol)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'Reply with: "OPENAI_TO_CODEX_OK"' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const text = await resp.text();
    if (!text.includes('chat.completion.chunk') || !text.includes('[DONE]')) {
      throw new Error(`Expected OpenAI Chat chunks from Codex. Got:\n${text.slice(0, 300)}`);
    }
  });

  // ---------------- Test 12: Live Codex Flagship (gpt-6.1-sol) ----------------
  await assertTest('Live Codex Flagship via Anthropic /v1/messages (gpt-6.1-sol)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEST_API_KEY
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        max_tokens: 30,
        messages: [{ role: 'user', content: 'Say hello in 3 words' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const text = await resp.text();
    if (!text.includes('message_start') || !text.includes('content_block_delta')) {
      throw new Error(`Expected Anthropic SSE stream from gpt-6.1-sol. Got:\n${text.slice(0, 300)}`);
    }
  });

  // ---------------- Test 13: Non-streaming Anthropic & OpenAI aggregation (stream: false) ----------------
  await assertTest('Non-streaming Anthropic /v1/messages aggregation (stream: false)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEST_API_KEY
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        max_tokens: 30,
        stream: false,
        messages: [{ role: 'user', content: 'Reply with "NON_STREAM_OK"' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    if (!data.id || !Array.isArray(data.content) || data.content.length === 0 || !data.usage) {
      throw new Error(`Invalid non-streaming Anthropic response: ${JSON.stringify(data)}`);
    }
  });

  await assertTest('Non-streaming OpenAI /v1/chat/completions aggregation (stream: false)', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        stream: false,
        messages: [{ role: 'user', content: 'Reply with "NON_STREAM_OPENAI_OK"' }]
      })
    });
    if (!resp.ok) {
      throw new Error(`Status ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    if (!data.id || !Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0].message || !data.usage) {
      throw new Error(`Invalid non-streaming OpenAI response: ${JSON.stringify(data)}`);
    }
  });

  // ---------------- Test 14: Model Aggregation includes Codex models ----------------
  await assertTest('Model List Aggregation contains Codex and Google models', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    const modelIds = data.data.map((m: any) => m.id);
    if (!modelIds.includes('gpt-6.1-sol')) {
      throw new Error(`Expected gpt-6.1-sol in model list. Found: ${modelIds.join(', ')}`);
    }
    if (!modelIds.includes('claude-sonnet-4-6')) {
      throw new Error(`Expected claude-sonnet-4-6 in model list. Found: ${modelIds.join(', ')}`);
    }
  });

  // ---------------- Test 15: Admin API: GET /v1/admin/google/accounts ----------------
  await assertTest('Admin API: GET /v1/admin/google/accounts returns account pool state', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/admin/google/accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data.data) || 'strategy' in data || data.data.some((account: any) => 'cooldowns' in account)) {
      throw new Error(`Unexpected admin payload: ${JSON.stringify(data)}`);
    }
  });

  // ---------------- Test 16: Removed strategy endpoint ----------------
  await assertTest('Admin API: removed strategy endpoint returns 404', async () => {
    const strategyUrl = `http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/admin/google/accounts/strategy`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TEST_API_KEY}` };
    const resp = await fetch(strategyUrl, {
      method: 'PATCH', headers, body: JSON.stringify({ strategy: 'round-robin' })
    });
    if (resp.status !== 404) throw new Error(`Expected 404, got ${resp.status}`);
  });

  // ---------------- Test 17: Web Dashboard: GET / ----------------
  await assertTest('Web Dashboard: GET / returns HTML control panel', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/`);
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html')) throw new Error(`Expected text/html, got ${ct}`);
    const html = await resp.text();
    if (!html.includes('Virtual Model Provider Gateway') || !html.includes('Google 账号池')) {
      throw new Error('HTML does not contain expected dashboard markers');
    }
  });

  // ---------------- Test 18: Admin API: GET /v1/admin/google/accounts/oauth-url ----------------
  await assertTest('Admin API: GET /v1/admin/google/accounts/oauth-url returns Google OAuth URL', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/admin/google/accounts/oauth-url`, {
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (!data.url || !data.url.includes('accounts.google.com') || !data.url.includes('client_id')) {
      throw new Error(`Unexpected oauth payload: ${JSON.stringify(data)}`);
    }
  });

  // ---------------- Test 19: Admin API: GET /v1/admin/google/quota ----------------
  await assertTest('Admin API: GET /v1/admin/google/quota returns quota report', async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_GATEWAY_PORT}/v1/admin/google/quota`, {
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    if (data.object !== 'google_quota_report' || !Array.isArray(data.accounts) || 'summary' in data) {
      throw new Error(`Unexpected quota report format: ${JSON.stringify(data)}`);
    }
    for (const account of data.accounts) {
      if (account.status !== 'ok' || account.source !== 'retrieveUserQuotaSummary' || !account.groups?.some(group => group.buckets?.length)) {
        throw new Error('Google account did not return subscription pool windows');
      }
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('='.repeat(70));

  gatewayServer.close();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('[Fatal Test Error]:', err);
  process.exit(1);
});
