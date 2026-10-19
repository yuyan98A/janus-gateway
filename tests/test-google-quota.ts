import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { GoogleAccountPool } from '../src/providers/google/account-pool/pool.ts';
import { GoogleProviderClient } from '../src/providers/google/client.ts';
import { parseGoogleQuotaGroups, parseGoogleQuotaPayload } from '../src/providers/google/quota.ts';
import { googleQuotaScript } from '../src/ingress/web/client/google-quota.ts';
import { gatewayScript } from '../src/ingress/web/client/gateway.ts';
import { accountsScript } from '../src/ingress/web/client/accounts.ts';
import { getClientScript } from '../src/ingress/web/client/index.ts';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-google-quota-'));
const accountsPath = path.join(tempDir, 'accounts.json');
const originalFetch = globalThis.fetch;
const endpoint = 'https://daily-cloudcode-pa.googleapis.com';
const endpoints = [endpoint, 'https://daily-cloudcode-pa.sandbox.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
const resetTime = '2026-10-24T10:19:57Z';
const accounts = ['first', 'second'].map(id => ({
  id, email: `${id}@example.test`, refreshToken: `${id}-secret`, projectId: `${id}-project`, enabled: true
}));
fs.writeFileSync(accountsPath, JSON.stringify({ accounts }));
const pool = new GoogleAccountPool({ accountsPath, autoReload: false });
pool.getAccessToken = async account => ({ accessToken: `${account.id}-access`, projectId: `${account.id}-project`, expiresAt: Date.now() + 60000 });
const client = new GoogleProviderClient(pool);
let firstFraction: unknown = '0.22682679';
let mode: 'normal' | 'http-error' | 'malformed' | 'missing' | 'network-error' | 'partial' = 'normal';
let quotaCalls = 0;
let failingHosts = 3;
let subscriptionFails = false;
let firstHosts: string[] = [];

globalThis.fetch = (async (input, init) => {
  const url = String(input);
  const first = new Headers(init?.headers).get('Authorization') === 'Bearer first-access';
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('User-Agent'), 'antigravity/hub/2.23.0 darwin/arm64');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.has('X-Client-Name'), false, 'quota calls use the CPA minimal Hub headers');
  if (url.endsWith(':loadCodeAssist')) {
    assert.equal(url, endpoint + '/v1internal:loadCodeAssist');
    if (first && subscriptionFails) return new Response('', { status: 503 });
    return Response.json({ paidTier: { id: first ? 'g1-pro-tier' : 'g1-ultra-tier', name: first ? 'Google AI Pro' : 'Google AI Ultra' } });
  }
  const host = new URL(url).origin;
  assert.ok(endpoints.includes(host));
  assert.equal(new URL(url).pathname, '/v1internal:retrieveUserQuotaSummary');
  if (first) firstHosts.push(host);
  const failing = first && endpoints.indexOf(host) < failingHosts;
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), { project: `${first ? 'first' : 'second'}-project` });
  assert.ok(init?.signal, 'quota fetch must be bounded');
  quotaCalls++;
  if (failing && mode === 'http-error') return new Response('', { status: 503 });
  if (failing && mode === 'network-error') throw new Error('connection failed Bearer secret-token');
  if (failing && mode === 'malformed') return Response.json({ models: { fake: { quotaInfo: { remainingFraction: 1 } } } });
  if (failing && mode === 'missing') return Response.json({ groups: [{ buckets: [{ window: '5h', resetTime }] }] });
  const groups = [
    { displayName: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', buckets: [
      { bucketId: 'gemini-5h', window: '5h', remainingFraction: first ? firstFraction : 1, resetTime },
      { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: first ? 0.5 : 1, resetTime }
    ] },
    { displayName: 'Claude and GPT models', buckets: [
      { bucketId: '3p-weekly', window: 'weekly', remainingFraction: first ? 0 : 1, resetTime },
      { bucketId: '3p-5h', window: '5h', remainingFraction: 1, resetTime }
    ] },
    { displayName: 'Unknown windows', buckets: [
      { bucketId: 'missing', window: 'other', resetTime },
      { bucketId: 'null', remainingFraction: null },
      { bucketId: 'empty', remainingFraction: '' },
      { bucketId: 'invalid', remainingFraction: 'unknown', resetTime: 'invalid date' },
      { bucketId: 'boolean', remainingFraction: true },
      { bucketId: 'over', remainingFraction: 1.5 },
      { bucketId: 'negative', remainingFraction: -1 }
    ] }
  ];
  return Response.json({ groups: first && mode === 'partial' ? [groups[1]] : groups, description: 'Subscription usage windows' },
    { headers: { Date: new Date(Date.now() + 60000).toUTCString() } });
}) as typeof fetch;

try {
  const report = await client.fetchQuota();
  assert.equal(report.accounts.length, 2);
  assert.equal('summary' in report, false);
  const [first, second] = report.accounts;
  assert.equal(first.status, 'ok');
  assert.equal(first.source, 'retrieveUserQuotaSummary');
  assert.equal(first.endpoint, endpoint);
  assert.equal(first.projectId, 'first-project');
  assert.ok(first.serverTimeOffsetMs! > 58000);
  const model = first.groups![0].buckets.find(b => b.bucketId === 'gemini-5h')!;
  assert.equal(model.remainingFraction, 0.22682679);
  assert.equal(model.remainingPercent, 22.68);
  assert.equal(model.available, true, 'partially consumed quota is still usable');
  assert.equal(model.resetTime, resetTime);
  assert.equal(second.groups![0].buckets.find(b => b.bucketId === model.bucketId)!.remainingPercent, 100, 'each account keeps its own pool windows');
  const exhausted = first.groups![1].buckets.find(b => b.window === 'weekly')!;
  assert.equal(exhausted.remainingPercent, 0);
  assert.equal(exhausted.available, false);
  assert.equal(first.groups!.length, 2, 'unparseable buckets and empty groups are filtered, not filled to 100%');
  assert.equal(first.groups!.some(g => g.displayName === 'Unknown windows'), false);
  assert.deepEqual(firstHosts, [endpoint], 'healthy daily response must not be replaced by production data');
  const blocked = first.groups![1].buckets.find(b => b.window === '5h')!;
  assert.equal(blocked.remainingPercent, 100);
  assert.equal(blocked.available, false, 'weekly exhaustion blocks the positive 5-hour window without falsifying its value');
  assert.doesNotMatch(JSON.stringify(report), /first-secret|first-access|Bearer|Gemini Argon/);

  firstFraction = 0.12;
  const callsBefore = quotaCalls;
  const fresh = await client.fetchQuota('FIRST@EXAMPLE.TEST');
  assert.equal(quotaCalls - callsBefore, 1, 'targeted query only fetches that account');
  assert.equal(fresh.accounts[0].groups![0].buckets.find(b => b.bucketId === model.bucketId)!.remainingPercent, 12, 'refresh reads new subscription values');
  assert.deepEqual((await client.fetchQuota('nonexistent')).accounts, []);
  for (const failure of ['http-error', 'network-error'] as const) {
    mode = failure;
    const failed = await client.fetchQuota();
    assert.equal(failed.accounts[0].status, 'error', failure);
    assert.equal(failed.accounts[0].groups, undefined);
    assert.equal(failed.accounts[1].status, 'ok', 'one account failure must not hide the other');
    assert.doesNotMatch(failed.accounts[0].error!, /secret-token/);
  }

  for (const failure of ['http-error', 'network-error', 'malformed', 'missing'] as const) {
    for (const count of [1, 2]) {
      mode = failure; failingHosts = count; firstHosts = [];
      const recovered = await client.fetchQuota('first');
      assert.equal(recovered.accounts[0].status, 'ok', failure);
      assert.equal(recovered.accounts[0].endpoint, endpoints[count]);
      assert.deepEqual(firstHosts, endpoints.slice(0, count + 1), 'fall back in CPA order and stop on valid groups');
      assert.equal(recovered.accounts[0].groups![0].buckets.find(b => b.bucketId === 'gemini-5h')!.remainingPercent, 12);
    }
  }
  for (const failure of ['malformed', 'missing'] as const) {
    mode = failure; failingHosts = 3; firstHosts = [];
    const empty = await client.fetchQuota('first');
    assert.equal(empty.accounts[0].status, 'ok', 'successful-but-empty responses preserve the unknown state');
    assert.deepEqual(empty.accounts[0].groups, []);
    assert.deepEqual(firstHosts, endpoints);
  }
  mode = 'normal'; subscriptionFails = true; firstHosts = [];
  const withoutPlan = await client.fetchQuota('first');
  assert.equal(withoutPlan.accounts[0].status, 'ok');
  assert.equal(withoutPlan.accounts[0].subscription, undefined, 'optional subscription failure must not discard quota');
  subscriptionFails = false;
  firstHosts = [];
  mode = 'partial';
  const partial = await client.fetchQuota('first');
  assert.equal(partial.accounts[0].status, 'ok');
  assert.equal(partial.accounts[0].groups!.length, 1, 'missing upstream pools are not invented');
  assert.equal(partial.accounts[0].groups![0].displayName, 'Claude and GPT models');
  assert.deepEqual(firstHosts, [endpoint], 'a valid partial group must not trigger cross-environment supplementation');

  const snake = parseGoogleQuotaGroups(parseGoogleQuotaPayload({ body: JSON.stringify({
    groups: [{ display_name: 'Snake pool', buckets: [
      { bucket_id: 'five', display_name: 'Session', window: 'five_hour', remaining_fraction: '89.86%', reset_time: resetTime },
      { bucket_id: 'week', window: 'week', remaining_fraction: 0 },
      { bucket_id: 'invalid', remaining_fraction: null }
    ] }]
  }) }));
  assert.equal(snake[0].displayName, 'Snake pool');
  assert.equal(snake[0].buckets.length, 2);
  assert.equal(snake[0].buckets[0].remainingPercent, 89.86);
  assert.equal(snake[0].buckets[0].window, '5h');
  assert.equal(snake[0].buckets[0].available, false);
  assert.equal(snake[0].buckets[0].resetTime, resetTime);
  assert.equal(snake[0].buckets[1].window, 'weekly');
  assert.deepEqual(parseGoogleQuotaGroups(null), []);
  assert.deepEqual(parseGoogleQuotaGroups({ groups: [{ buckets: [{ remainingFraction: '%' }] }] }), []);

  // Execute the real browser code with independent account values and unknown fields.
  for (const page of ['home', 'google-accounts'] as const) {
    new vm.Script(getClientScript({ defaultApiKey: 'test', page }));
  }
  const elements = new Map<string, any>();
  for (const id of ['home-google-accounts-count', 'home-google-accounts-detail', 'home-google-quota-summary-tag', 'home-google-quota-list', 'accounts-tbody', 'google-quota-summary', 'all-quotas-modal', 'all-quotas-modal-meta', 'all-quotas-modal-desc', 'all-quotas-modal-windows']) {
    elements.set(id, { innerHTML: '', textContent: '', style: {}, showModal() { this.shown = true; } });
  }
  const context = vm.createContext({
    API_KEY: 'test', DASHBOARD_PAGE: 'home', console, Date,
    escapeHtml: (v: unknown) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    formatDateTime: (v: string) => v,
    document: { getElementById: (id: string) => elements.get(id) },
    toast: { success() {}, error() {} },
    fetch: async (url: string) => Response.json(url === '/v1/admin/google/accounts' ? { data: accounts } : report)
  });
  vm.runInContext(googleQuotaScript + gatewayScript + accountsScript, context);
  await vm.runInContext('loadHomeGoogleLifeline()', context);
  const home = elements.get('home-google-quota-list').innerHTML;
  assert.match(home, /first@example.test/);
  assert.match(home, /second@example.test/);
  assert.match(home, /22\.68%/);
  assert.match(home, /100\.00%/);
  assert.match(home, /Gemini Models/);
  assert.match(home, /Claude and GPT models/);
  assert.match(home, /周额度/);
  assert.match(home, /5 小时额度/);
  assert.match(home, /周额度已耗尽/);
  assert.doesNotMatch(home, /gemini-2\.5-flash|NaN/);
  await vm.runInContext('refreshGoogleQuotas()', context);
  assert.match(elements.get('accounts-tbody').innerHTML, /22\.68%/);
  assert.match(elements.get('accounts-tbody').innerHTML, /onclick="openAccountQuotaModal\('first'\)"/);
  vm.runInContext("openAccountQuotaModal('first')", context);
  const details = elements.get('all-quotas-modal-windows').innerHTML;
  assert.doesNotMatch(details, /Unknown windows/);
  assert.match(vm.runInContext('renderGoogleQuotaPools({ groups: [] })', context), /配额未知/);
  assert.match(details, /22\.68%/);
  assert.doesNotMatch(details, /NaN|undefined/);
  assert.equal(elements.get('all-quotas-modal').shown, true);
  assert.equal(vm.runInContext("googleQuotaResetText({ resetTime: new Date(Date.now() + 60000).toISOString() }, 120000)", context), '已到重置时间，请刷新配额');
  context.fetch = async () => { throw new Error('offline'); };
  await vm.runInContext('loadHomeGoogleLifeline()', context);
  assert.match(elements.get('home-google-quota-list').innerHTML, /offline/);
  assert.doesNotMatch(elements.get('home-google-quota-list').innerHTML, /22\.68%/);
  console.log('Google quota: CPA Hub headers, ordered fallback, parsing, per-account windows, and dashboard rendering PASSED');
} finally {
  globalThis.fetch = originalFetch;
  pool.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
