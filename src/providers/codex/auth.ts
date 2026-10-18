import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface CodexTokens {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
}

export interface CodexAuthFile {
  auth_mode?: string;
  tokens?: CodexTokens;
  last_refresh?: string;
  [key: string]: any;
}

export interface CodexAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  isFedramp?: boolean;
}

export interface CodexAuthStatus {
  status: 'missing' | 'invalid' | 'missing_access_token' | 'expired' | 'expiring' | 'ready' | 'unknown_expiry';
  authMode?: string;
  accountIdMasked?: string;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  canRefresh: boolean;
  expiresAt?: string;
  lastRefresh?: string;
}

export class CodexAuthManager {
  private authPath: string;
  private currentCreds: CodexAuthCredentials | null = null;
  private refreshPromise: Promise<CodexAuthCredentials> | null = null;

  private readonly TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
  private readonly CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
  private readonly SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke';

  constructor(authPath?: string) {
    this.authPath = authPath || path.join(os.homedir(), '.codex', 'auth.json');
  }

  /** Read non-secret account metadata for the admin status panel. */
  public getStatus(): CodexAuthStatus {
    if (!fs.existsSync(this.authPath)) {
      return {
        status: 'missing',
        hasAccessToken: false,
        hasRefreshToken: false,
        canRefresh: false
      };
    }

    try {
      const data: CodexAuthFile = JSON.parse(fs.readFileSync(this.authPath, 'utf8'));
      const accessToken = data.tokens?.access_token || '';
      const refreshToken = data.tokens?.refresh_token || '';
      const claims = this.parseJwt(data.tokens?.id_token || accessToken);
      const authClaim = claims?.['https://api.openai.com/auth'] || {};
      const accountId = data.tokens?.account_id || authClaim.chatgpt_account_id || authClaim.account_id;
      const exp = this.parseJwt(accessToken)?.exp;
      const expiresAt = typeof exp === 'number' ? new Date(exp * 1000).toISOString() : undefined;
      const remainingMs = typeof exp === 'number' ? exp * 1000 - Date.now() : undefined;

      let status: CodexAuthStatus['status'];
      if (!accessToken) status = 'missing_access_token';
      else if (remainingMs === undefined) status = 'unknown_expiry';
      else if (remainingMs <= 60_000) status = 'expired';
      else if (remainingMs <= 5 * 60_000) status = 'expiring';
      else status = 'ready';

      return {
        status,
        ...(data.auth_mode ? { authMode: data.auth_mode } : {}),
        ...(accountId ? { accountIdMasked: maskAccountId(String(accountId)) } : {}),
        hasAccessToken: Boolean(accessToken),
        hasRefreshToken: Boolean(refreshToken),
        canRefresh: Boolean(refreshToken),
        ...(expiresAt ? { expiresAt } : {}),
        ...(data.last_refresh ? { lastRefresh: data.last_refresh } : {})
      };
    } catch {
      return {
        status: 'invalid',
        hasAccessToken: false,
        hasRefreshToken: false,
        canRefresh: false
      };
    }
  }

  /**
   * Load credentials from auth.json
   */
  public loadCredentials(): CodexAuthCredentials {
    if (!fs.existsSync(this.authPath)) {
      throw new Error(`Codex auth file not found at: ${this.authPath}. Please ensure Codex CLI is logged in.`);
    }

    try {
      const content = fs.readFileSync(this.authPath, 'utf8');
      const data: CodexAuthFile = JSON.parse(content);
      const tokens = data.tokens || {};

      let accessToken = tokens.access_token || '';
      let refreshToken = tokens.refresh_token;
      let accountId = tokens.account_id;
      let isFedramp = false;

      // Extract account_id or fedramp from JWT token if available
      const jwtToInspect = tokens.id_token || accessToken;
      if (jwtToInspect) {
        const parsed = this.parseJwt(jwtToInspect);
        if (parsed) {
          const authClaim = parsed['https://api.openai.com/auth'] || {};
          if (!accountId) {
            accountId = authClaim.chatgpt_account_id || authClaim.account_id;
          }
          if (authClaim.chatgpt_account_is_fedramp) {
            isFedramp = true;
          }
        }
      }

      this.currentCreds = {
        accessToken,
        refreshToken,
        accountId,
        isFedramp
      };

      return this.currentCreds;
    } catch (err: any) {
      throw new Error(`Failed to read Codex auth credentials from ${this.authPath}: ${err.message}`);
    }
  }

  /**
   * Parse JWT claims without external dependencies
   */
  private parseJwt(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
      const json = Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * Check if the current access token is expired or expiring within bufferMs
   */
  public isTokenExpired(bufferMs = 60000): boolean {
    if (!this.currentCreds || !this.currentCreds.accessToken) return true;
    const claims = this.parseJwt(this.currentCreds.accessToken);
    if (!claims || !claims.exp) return false; // Unknown exp, assume valid until 401
    const expiryTime = claims.exp * 1000;
    return Date.now() + bufferMs >= expiryTime;
  }

  /**
   * Get valid credentials, refreshing if expired
   */
  public async getCredentials(forceRefresh = false): Promise<CodexAuthCredentials> {
    if (!this.currentCreds) {
      this.loadCredentials();
    }

    if (forceRefresh || this.isTokenExpired()) {
      return this.refreshAccessToken();
    }

    return this.currentCreds!;
  }

  /**
   * Refresh OAuth access token via OpenAI auth endpoint
   */
  public async refreshAccessToken(): Promise<CodexAuthCredentials> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        if (!this.currentCreds) {
          this.loadCredentials();
        }

        const refreshToken = this.currentCreds?.refreshToken;
        if (!refreshToken) {
          throw new Error('No refresh_token found in Codex auth.json to refresh access token.');
        }

        const resp = await fetch(this.TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client_id: this.CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            scope: this.SCOPES
          })
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`Codex OAuth token refresh failed (${resp.status}): ${errBody}`);
        }

        const tokenData = await resp.json();
        const newAccessToken = tokenData.access_token;
        const newRefreshToken = tokenData.refresh_token || refreshToken;
        const newIdToken = tokenData.id_token;

        // Parse claims for accountId
        let accountId = this.currentCreds?.accountId;
        let isFedramp = this.currentCreds?.isFedramp;
        const claims = this.parseJwt(newIdToken || newAccessToken);
        if (claims) {
          const authClaim = claims['https://api.openai.com/auth'] || {};
          accountId = authClaim.chatgpt_account_id || authClaim.account_id || accountId;
          if (authClaim.chatgpt_account_is_fedramp !== undefined) {
            isFedramp = !!authClaim.chatgpt_account_is_fedramp;
          }
        }

        this.currentCreds = {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          accountId,
          isFedramp
        };

        // Write back to auth.json
        try {
          const content = fs.readFileSync(this.authPath, 'utf8');
          const data: CodexAuthFile = JSON.parse(content);
          data.tokens = {
            ...data.tokens,
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            ...(newIdToken ? { id_token: newIdToken } : {}),
            ...(accountId ? { account_id: accountId } : {})
          };
          data.last_refresh = new Date().toISOString();
          fs.writeFileSync(this.authPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (err: any) {
          console.warn(`[CodexAuthManager] Failed to persist refreshed token to ${this.authPath}:`, err.message);
        }

        return this.currentCreds;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Get headers required for requests to ChatGPT/Codex backend
   */
  public async getHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const creds = await this.getCredentials(forceRefresh);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${creds.accessToken}`,
      'User-Agent': 'codex-cli'
    };

    if (creds.accountId) {
      headers['ChatGPT-Account-ID'] = creds.accountId;
    }
    if (creds.isFedramp) {
      headers['X-OpenAI-Fedramp'] = 'true';
    }

    return headers;
  }
}

function maskAccountId(accountId: string): string {
  return accountId.length <= 4 ? '••••' : `••••${accountId.slice(-4)}`;
}
