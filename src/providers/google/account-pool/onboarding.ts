import http from 'node:http';
import crypto from 'node:crypto';
import { GOOGLE_OAUTH_CLIENT, type ValidatedAccountResult } from './validator.ts';
import type { GoogleAccountPool } from './pool.ts';

const OAUTH_PORTS = [51121, 51122, 51123, 51124, 51125, 51126];

export interface OAuthFlowSession {
  url: string;
  state: string;
  port: number;
  promise: Promise<ValidatedAccountResult>;
  cancel: () => void;
}

let activeOAuthSession: OAuthFlowSession | null = null;

export class GoogleAccountOnboarding {
  /**
   * Start the OAuth authorization flow with local callback server and PKCE.
   * If an active session is already listening and not expired, reuse it.
   */
  public static async startOAuthFlow(
    pool: GoogleAccountPool,
    gatewayPort = 18763
  ): Promise<OAuthFlowSession> {
    if (activeOAuthSession) {
      try {
        activeOAuthSession.cancel();
      } catch (_) {}
      activeOAuthSession = null;
    }

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    let boundServer: http.Server | null = null;
    let boundPort = 51121;

    for (const p of OAUTH_PORTS) {
      try {
        const s = http.createServer();
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(p, '127.0.0.1', () => resolve());
        });
        boundServer = s;
        boundPort = p;
        break;
      } catch (err: any) {
        // Port busy, try next
      }
    }

    if (!boundServer) {
      throw new Error(`Failed to bind any OAuth callback port in [${OAUTH_PORTS.join(', ')}]`);
    }

    const redirectUri = `http://localhost:${boundPort}/oauth-callback`;
    const scope = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email';

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      new URLSearchParams({
        client_id: GOOGLE_OAUTH_CLIENT.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state
      }).toString();

    let timeoutTimer: NodeJS.Timeout | null = null;
    let cancelFn = () => {};

    const promise = new Promise<ValidatedAccountResult>((resolve, reject) => {
      cancelFn = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (boundServer) boundServer.close();
        reject(new Error('OAuth session cancelled.'));
      };

      timeoutTimer = setTimeout(() => {
        if (boundServer) boundServer.close();
        if (activeOAuthSession?.state === state) activeOAuthSession = null;
        reject(new Error('OAuth authorization timed out after 5 minutes.'));
      }, 5 * 60 * 1000);

      boundServer.on('request', async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${boundPort}`);

        if (url.pathname === '/oauth-callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          const reqState = url.searchParams.get('state');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>Google 授权失败</h2><p>${error}</p>`);
            if (timeoutTimer) clearTimeout(timeoutTimer);
            boundServer?.close();
            activeOAuthSession = null;
            reject(new Error(`Google OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>授权失败</h2><p>未收到有效的 authorization code。</p>`);
            return;
          }

          try {
            // Exchange code for tokens with PKCE verifier
            const tokenResp = await fetch(GOOGLE_OAUTH_CLIENT.tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: GOOGLE_OAUTH_CLIENT.clientId,
                client_secret: GOOGLE_OAUTH_CLIENT.clientSecret,
                code,
                code_verifier: verifier,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
              })
            });

            if (!tokenResp.ok) {
              const errBody = await tokenResp.text();
              throw new Error(`Token exchange failed (${tokenResp.status}): ${errBody}`);
            }

            const tokenData = await tokenResp.json();
            const refreshToken = tokenData.refresh_token;

            if (!refreshToken) {
              throw new Error('Google did not return a refresh_token. Please retry and ensure consent.');
            }

            // Validate and add to pool
            const account = await pool.addAccount(refreshToken, 'Browser OAuth Login');

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <title>授权成功</title>
                  <meta http-equiv="refresh" content="2;url=http://127.0.0.1:${gatewayPort}/google-accounts?login=success">
                  <style>
                    body {
                      background: #0f1117;
                      color: #f1f3f9;
                      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                      text-align: center;
                      padding: 60px 20px;
                    }
                    .box {
                      max-width: 480px;
                      margin: 0 auto;
                      background: #181b24;
                      border: 1px solid #262b38;
                      border-radius: 12px;
                      padding: 32px;
                    }
                    h1 { color: #10b981; font-size: 22px; margin-bottom: 12px; }
                    p { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
                    .email { color: #60a5fa; font-weight: bold; font-family: monospace; }
                    a { color: #3b82f6; text-decoration: none; font-size: 13px; }
                  </style>
                </head>
                <body>
                  <div class="box">
                    <h1>✅ Google 账号授权成功！</h1>
                    <p>账号 <span class="email">${account.email}</span> 已成功加入网关账号池。</p>
                    <p>正在自动跳转回控制台...</p>
                    <a href="http://127.0.0.1:${gatewayPort}/">如果未自动跳转，请点击此处返回</a>
                  </div>
                </body>
              </html>
            `);

            if (timeoutTimer) clearTimeout(timeoutTimer);
            setTimeout(() => {
              boundServer?.close();
              if (activeOAuthSession?.state === state) activeOAuthSession = null;
            }, 1000);

            resolve({
              email: account.email,
              projectId: account.projectId!,
              accessToken: tokenData.access_token,
              expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
            });
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>添加账号失败</h2><p>${err.message}</p>`);
            if (timeoutTimer) clearTimeout(timeoutTimer);
            boundServer?.close();
            activeOAuthSession = null;
            reject(err);
          }
        }
      });
    });

    // Attach default catch handler to prevent unhandled rejection if caller does not await
    promise.catch(() => {});

    const session: OAuthFlowSession = {
      url: authUrl,
      state,
      port: boundPort,
      promise,
      cancel: cancelFn
    };

    activeOAuthSession = session;
    return session;
  }

  /**
   * For CLI interactive login
   */
  public static async loginWithBrowser(pool: GoogleAccountPool, gatewayPort = 18763): Promise<ValidatedAccountResult> {
    const session = await this.startOAuthFlow(pool, gatewayPort);
    console.log('\n' + '='.repeat(70));
    console.log('🔗 Please open the following URL in your browser to authorize your Google Account:');
    console.log('\n' + session.url + '\n');
    console.log('='.repeat(70) + '\n');
    return session.promise;
  }
}
