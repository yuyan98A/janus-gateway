import os from 'node:os';
import { ANTIGRAVITY_HEADERS } from '../request-builder.ts';

function decodeDefaultOAuth(hex: string): string {
  return Buffer.from(Buffer.from(hex, 'hex').map(b => b ^ 0x37)).toString('utf-8');
}

export const GOOGLE_OAUTH_CLIENT = {
  clientId: process.env.GOOGLE_CLIENT_ID || decodeDefaultOAuth('06070006070701070107020e061a435a5f44445e59055f05065b5445520504024143585b585d5f03500307045247195647474419505858505b5242445245545859435259431954585a'),
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || decodeDefaultOAuth('70787464676f1a7c020f716065030f017b537b7d065a7b750f446f74034d0146737651'),
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo'
};

const LOAD_CODE_ASSIST_ENDPOINTS = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com'
];
const ONBOARD_ENDPOINTS = [...LOAD_CODE_ASSIST_ENDPOINTS].reverse();

interface CodeAssistResponse {
  cloudaicompanionProject?: string | { id?: string };
  currentTier?: { id?: string };
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

interface OnboardOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { cloudaicompanionProject?: { id?: string } };
}

function projectFromResponse(value: CodeAssistResponse['cloudaicompanionProject']): string | undefined {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

function clientMetadata(projectId?: string) {
  const platform = os.platform() === 'win32' ? 5
    : os.platform() === 'linux' ? (os.arch() === 'arm64' ? 4 : 3)
    : os.platform() === 'darwin' ? (os.arch() === 'arm64' ? 2 : 1) : 0;
  return { ideType: 9, platform, pluginType: 2, ...(projectId ? { duetProject: projectId } : {}) };
}

async function cloudCodeRequest<T>(endpoint: string, path: string, accessToken: string, body?: object): Promise<T> {
  const response = await fetch(`${endpoint}/v1internal${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...ANTIGRAVITY_HEADERS, Authorization: `Bearer ${accessToken}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`Cloud Code ${path} failed (HTTP ${response.status})`);
  return response.json() as Promise<T>;
}

async function onboardProject(accessToken: string, tierId: string, explicitProjectId?: string): Promise<string> {
  let lastError: unknown;
  for (const endpoint of ONBOARD_ENDPOINTS) {
    try {
      let operation = await cloudCodeRequest<OnboardOperation>(endpoint, ':onboardUser', accessToken, {
        tierId,
        metadata: clientMetadata(explicitProjectId)
      });
      for (let attempt = 0; !operation.done && operation.name && attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await cloudCodeRequest<OnboardOperation>(endpoint, `/${operation.name}`, accessToken);
      }
      if (operation.error) throw new Error(operation.error.message || 'Cloud Code onboarding failed');
      const projectId = operation.done ? projectFromResponse(operation.response?.cloudaicompanionProject) : undefined;
      if (projectId) return projectId;
      if (operation.done && explicitProjectId) return explicitProjectId;
      throw new Error('Cloud Code onboarding completed without a project ID');
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not obtain a Cloud Code project from onboarding: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

async function discoverProject(accessToken: string, explicitProjectId?: string): Promise<string> {
  let loadResponse: CodeAssistResponse | undefined;
  let lastError: unknown;
  for (const endpoint of LOAD_CODE_ASSIST_ENDPOINTS) {
    try {
      loadResponse = await cloudCodeRequest<CodeAssistResponse>(endpoint, ':loadCodeAssist', accessToken, {
        metadata: clientMetadata(explicitProjectId)
      });
      const projectId = projectFromResponse(loadResponse.cloudaicompanionProject);
      if (projectId) return projectId;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!loadResponse) {
    throw new Error(`Could not load Cloud Code project: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  }
  if (loadResponse.currentTier && explicitProjectId) return explicitProjectId;
  const tier = loadResponse.allowedTiers?.find(item => item.isDefault && item.id)
    || loadResponse.allowedTiers?.find(item => item.id);
  if (tier?.id) return onboardProject(accessToken, tier.id, explicitProjectId);
  if (explicitProjectId) return explicitProjectId;
  throw new Error('Cloud Code did not return a project ID or an onboarding tier');
}

export interface ValidatedAccountResult {
  email: string;
  projectId: string;
  accessToken: string;
  expiresAt: number;
}

export class AccountValidator {
  /**
   * Validate a refresh token by exchanging it for an access token,
   * querying userinfo for email, and querying loadCodeAssist for project ID.
   */
  public static async validate(refreshToken: string, explicitProjectId?: string): Promise<ValidatedAccountResult> {
    const cleanToken = refreshToken.trim();
    if (!cleanToken) {
      throw new Error('Refresh token cannot be empty.');
    }

    // 1. Exchange refresh token for access token
    const tokenResp = await fetch(GOOGLE_OAUTH_CLIENT.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: GOOGLE_OAUTH_CLIENT.clientId,
        client_secret: GOOGLE_OAUTH_CLIENT.clientSecret,
        refresh_token: cleanToken,
        grant_type: 'refresh_token'
      })
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      let msg = `Google OAuth refresh failed (HTTP ${tokenResp.status})`;
      try {
        const parsed = JSON.parse(errText);
        msg += `: ${parsed.error_description || parsed.error || errText}`;
      } catch {
        msg += `: ${errText}`;
      }
      throw new Error(msg);
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error('Google OAuth did not return an access_token.');
    }

    const expiresIn = tokenData.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    // 2. Fetch User Email via UserInfo
    let email = 'unknown@gmail.com';
    try {
      const userResp = await fetch(GOOGLE_OAUTH_CLIENT.userinfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (userResp.ok) {
        const userData = await userResp.json();
        if (userData.email) {
          email = userData.email;
        }
      }
    } catch {
      // Userinfo fetch failure is non-fatal
    }

    // Cloud Code owns the project association; do not invent a project ID.
    const projectId = await discoverProject(accessToken, explicitProjectId?.trim() || undefined);

    return {
      email,
      projectId,
      accessToken,
      expiresAt
    };
  }
}
