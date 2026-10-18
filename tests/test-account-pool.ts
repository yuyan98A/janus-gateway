import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleAccountPool } from '../src/providers/google/account-pool/pool.ts';
import { GoogleProviderClient } from '../src/providers/google/client.ts';
import { AccountValidator } from '../src/providers/google/account-pool/validator.ts';
import { handleWeb } from '../src/ingress/web.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-account-pool-'));
const accountsPath = path.join(dir, 'google-accounts.json');
const accounts = [
  { id: 'first', email: 'first@example.test', refreshToken: 'first-token', projectId: 'aicode-consumers', enabled: true, addedAt: '2026-01-01' },
  { id: 'second', email: 'second@example.test', refreshToken: 'second-token', projectId: 'aicode-consumers', enabled: true, addedAt: '2026-01-01' }
];
const originalFetch = globalThis.fetch;

async function main() {
  // Old strategy settings are ignored; selection remains sticky.
  fs.writeFileSync(accountsPath, JSON.stringify({ accounts, settings: { strategy: 'round-robin', activeIndex: 0 } }));
  const pool = new GoogleAccountPool({ accountsPath, autoReload: false });
  assert.equal(pool.selectAccount().account?.id, 'first');
  assert.equal(pool.selectAccount().account?.id, 'first');
  pool.toggleAccount('first', false);
  assert.equal(pool.selectAccount().account?.id, 'second');
  pool.toggleAccount('first', true);
  assert.equal(pool.selectAccount().account?.id, 'second');
  assert.equal(pool.selectAccount(new Set(['first'])).account?.id, 'first');
  assert.equal(pool.selectAccount(new Set(['missing'])).account, null);
  pool.close();

  let accountPage = '';
  await handleWeb(
    { url: '/google-accounts', headers: { host: 'localhost' } } as any,
    { writeHead(status: number) { assert.equal(status, 200); }, end(body: string) { accountPage = body; } } as any,
    { server: { apiKey: 'test', port: 18763, host: '127.0.0.1' } } as any,
    {} as any
  );
  assert.match(accountPage, /Google 多账号池管理/);
  assert.doesNotMatch(accountPage, /strategy-select|updateStrategy|模型冷却倒计时/);

  // Token requests refresh independently; transient upstream failures retry on one account and endpoint.
  fs.writeFileSync(accountsPath, JSON.stringify({ accounts, settings: { activeIndex: 0 } }));
  const requestPool = new GoogleAccountPool({ accountsPath, autoReload: false });
  let refreshes = 0;
  let upstreamRequests = 0;
  let upstreamStatuses: number[] = [];
  const upstreamUrls: string[] = [];
  const upstreamTokens: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) {
      refreshes++;
      return Response.json({ access_token: `access-${refreshes}`, expires_in: 3600 });
    }
    if (url.includes('userinfo')) return Response.json({ email: 'first@example.test' });
    if (url.includes('loadCodeAssist')) return Response.json({ cloudaicompanionProject: 'real-google-project' });
    if (url.includes('streamGenerateContent')) {
      upstreamRequests++;
      upstreamUrls.push(url);
      upstreamTokens.push(String((init?.headers as Record<string, string>)?.Authorization));
      const status = upstreamStatuses.shift() ?? 429;
      return status === 200 ? new Response('data: {}\n\n') : Response.json({ error: 'upstream error' }, { status });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  try {
    const first = requestPool.getAccount('first')!;
    await requestPool.getAccessToken(first);
    assert.equal(first.projectId, 'real-google-project', 'legacy fallback is replaced by Google project');
    await requestPool.getAccessToken(first);
    assert.equal(refreshes, 2, 'access tokens are not cached or single-flight protected');
    await Promise.all([requestPool.getAccessToken(first), requestPool.getAccessToken(first)]);
    assert.equal(refreshes, 4, 'concurrent token requests are not combined');

    const client = new GoogleProviderClient(requestPool);
    const request = { model: 'claude-sonnet-4-6', max_tokens: 50, messages: [{ role: 'user' as const, content: 'hello' }] };
    upstreamStatuses = [429, 429, 429];
    await assert.rejects(async () => { for await (const _ of client.handleAnthropicMessages(request)) {} }, /429/);
    assert.equal(upstreamRequests, 3, '429 retries twice before reporting the final error');
    assert.equal(new Set(upstreamUrls).size, 1, 'retries stay on one endpoint');
    assert.equal(new Set(upstreamTokens).size, 1, 'retries reuse one account token');
    assert.equal(requestPool.selectAccount().account?.id, 'first', '429 must not switch accounts');

    upstreamStatuses = [503, 200];
    const recovered = await (client as any).fetchStream({ model: 'claude-sonnet-4-6' }, 'claude-sonnet-4-6');
    assert.ok(recovered.stream);
    assert.equal(recovered.accountId, 'first');
    assert.equal(upstreamRequests, 5, 'a transient 503 succeeds on retry');

    upstreamStatuses = [400];
    await assert.rejects((client as any).fetchStream({ model: 'claude-sonnet-4-6' }, 'claude-sonnet-4-6'), /400/);
    assert.equal(upstreamRequests, 6, 'a validation error is not retried');
  } finally {
    globalThis.fetch = originalFetch;
    requestPool.close();
  }
  let onboardingCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'access', expires_in: 3600 });
    if (url.includes('userinfo')) return Response.json({ email: 'new@example.test' });
    if (url.includes('loadCodeAssist')) {
      assert.ok(url.startsWith('https://cloudcode-pa.googleapis.com/'), 'project discovery uses production first');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.metadata.ideType, 9);
      assert.equal(body.metadata.pluginType, 2);
      assert.equal(body.client_metadata, undefined);
      return Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] });
    }
    if (url.includes('onboardUser')) {
      onboardingCalls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.tierId, 'free-tier');
      assert.equal(body.cloudaicompanionProject, undefined);
      return Response.json({ done: true, response: { cloudaicompanionProject: { id: 'managed-project' } } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  try {
    const validated = await AccountValidator.validate('new-refresh-token');
    assert.equal(validated.projectId, 'managed-project');
    assert.equal(onboardingCalls, 1);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'access' });
      if (url.includes('userinfo')) return Response.json({ email: 'new@example.test' });
      if (url.includes('loadCodeAssist')) return Response.json({ cloudaicompanionProject: { id: 'object-project' } });
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    assert.equal((await AccountValidator.validate('new-refresh-token')).projectId, 'object-project');
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'access' });
      if (url.includes('userinfo')) return Response.json({ email: 'new@example.test' });
      if (url.includes('loadCodeAssist')) return Response.json({ currentTier: { id: 'free-tier' } });
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    await assert.rejects(AccountValidator.validate('new-refresh-token'), /did not return a project ID/);
    assert.equal((await AccountValidator.validate('new-refresh-token', 'team-project')).projectId, 'team-project');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('Google account pool, Cloud Code project discovery, and same-account retry: PASSED');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});
