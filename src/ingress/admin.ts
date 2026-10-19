import http from 'node:http';
import type { Dispatcher } from '../router/dispatcher.ts';
import { GoogleAccountOnboarding } from '../providers/google/account-pool/onboarding.ts';

export async function handleAdminGoogleAccounts(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dispatcher: Dispatcher,
  pathname: string,
  body?: any,
  gatewayPort = 18763
): Promise<void> {
  const googleClient = dispatcher.getGoogleClient();
  if (!googleClient) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Google provider is not enabled' } }));
    return;
  }

  const pool = googleClient.getPool();

  // Route 0: GET /v1/admin/google/accounts/oauth-url (Initiate Google OAuth Login Flow)
  if (pathname === '/v1/admin/google/accounts/oauth-url' || pathname === '/v1/admin/google/accounts/oauth-init') {
    try {
      const session = await GoogleAccountOnboarding.startOAuthFlow(pool, gatewayPort);
      session.promise.catch(() => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: session.url, state: session.state }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Failed to initiate OAuth flow: ${err.message}` } }));
    }
    return;
  }

  // Route 1: GET /v1/admin/google/accounts
  if (req.method === 'GET' && pathname === '/v1/admin/google/accounts') {
    const accounts = pool.listAccounts().map(acc => {
      return {
        id: acc.id,
        email: acc.email,
        label: acc.label,
        enabled: acc.enabled,
        projectId: acc.projectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        isInvalid: acc.isInvalid,
        invalidReason: acc.invalidReason
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        accountsPath: pool.getAccountsPath(),
        data: accounts
      })
    );
    return;
  }

  // Route 2: POST /v1/admin/google/accounts (Add Account)
  if (req.method === 'POST' && pathname === '/v1/admin/google/accounts') {
    const refreshToken = body?.refreshToken;
    if (!refreshToken) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Missing required field: refreshToken' } }));
      return;
    }

    try {
      const account = await pool.addAccount(refreshToken, body.label, body.projectId);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Account added successfully', account }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Failed to add account: ${err.message}` } }));
    }
    return;
  }

  // Route 3: DELETE /v1/admin/google/accounts/:id
  if (req.method === 'DELETE' && pathname.startsWith('/v1/admin/google/accounts/')) {
    const target = decodeURIComponent(pathname.slice('/v1/admin/google/accounts/'.length));
    const ok = pool.removeAccount(target);
    if (ok) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Account ${target} removed successfully` }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Account ${target} not found` } }));
    }
    return;
  }

  // Route 4: PATCH /v1/admin/google/accounts/:id
  if (req.method === 'PATCH' && pathname.startsWith('/v1/admin/google/accounts/')) {
    const target = decodeURIComponent(pathname.slice('/v1/admin/google/accounts/'.length));
    if (body?.enabled === undefined || !pool.toggleAccount(target, body.enabled)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Account ${target} not found or enabled is missing` } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `Account ${target} updated successfully` }));
    return;
  }

  // Route 5: GET /v1/admin/google/accounts/:id/quota or GET /v1/admin/google/accounts/quota
  if (req.method === 'GET' && pathname.includes('/quota')) {
    let target: string | undefined = undefined;
    if (pathname.startsWith('/v1/admin/google/accounts/') && pathname.endsWith('/quota')) {
      const sub = pathname.slice('/v1/admin/google/accounts/'.length, -'/quota'.length);
      if (sub) target = decodeURIComponent(sub);
    }
    await handleGoogleQuota(req, res, dispatcher, target);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `Not found: ${req.method} ${pathname}` } }));
}

export async function handleGoogleQuota(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dispatcher: Dispatcher,
  targetAccountId?: string
): Promise<void> {
  const googleClient = dispatcher.getGoogleClient();
  if (!googleClient) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Google provider is not enabled' } }));
    return;
  }

  try {
    const report = await googleClient.fetchQuota(targetAccountId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(report));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Failed to fetch Google quota: ${err.message}` } }));
  }
}
