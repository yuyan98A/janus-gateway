import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  AnthropicRequest,
  AnthropicEvent,
  OpenAIChatRequest,
  OpenAIChatChunk,
  ModelListItem,
  ResponsesRequest,
  CodexReasoningConfig,
  CodexReasoningEffort
} from '../../types.ts';
import { CodexAuthManager } from './auth.ts';
import { CodexRequestAdapter } from './request-adapter.ts';
import { CodexStreamAdapter } from './stream-adapter.ts';
import { getCodexReasoningProfile, resolveAnthropicReasoning, resolveOpenAIReasoning } from './reasoning.ts';
import { captureReadableStream, logTrace, serializeError } from '../../utils/logger.ts';

export class CodexProviderClient {
  private authManager: CodexAuthManager;
  private baseURL: string;
  private modelsCachePath: string;
  private reasoningConfig: CodexReasoningConfig;
  private lastConnectionCheck: {
    checkedAt: string;
    model: string;
    status: 'connected' | 'failed';
    httpStatus?: number;
    error?: string;
  } | null = null;
  private lastUsage: CodexUsageResult | null = null;
  private discoveredModels: ModelListItem[] | null = null;

  constructor(
    authPath?: string,
    baseURL = 'https://chatgpt.com/backend-api/codex',
    modelsCachePath?: string,
    reasoningConfig?: CodexReasoningConfig
  ) {
    this.authManager = new CodexAuthManager(authPath);
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.modelsCachePath = modelsCachePath || path.join(os.homedir(), '.codex', 'models_cache.json');
    this.reasoningConfig = reasoningConfig ?? {
      models: {},
      anthropicBudget: { lowMaxTokens: 2000, mediumMaxTokens: 8000 }
    };
  }

  /**
   * Internal fetch with 401 auto-refresh retry
   */
  private async fetchWithAuth(endpoint: string, options: { method: string; body?: string; signal?: AbortSignal }): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;
    let headers = await this.authManager.getHeaders(false);
    let attempt = 1;
    const send = async (): Promise<Response> => {
      const startedAt = Date.now();
      await logTrace('upstream.request', {
        provider: 'codex',
        attempt,
        method: options.method,
        url,
        headers: { ...headers },
        body: options.body
      });
      try {
        const response = await fetch(url, {
          method: options.method,
          headers,
          body: options.body,
          signal: options.signal
        });
        await logTrace('upstream.response_headers', {
          provider: 'codex',
          attempt,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          durationMs: Date.now() - startedAt
        });
        return response;
      } catch (error) {
        await logTrace('upstream.network_error', {
          provider: 'codex',
          attempt,
          durationMs: Date.now() - startedAt,
          error: serializeError(error)
        });
        throw error;
      }
    };

    let resp = await send();

    if (resp.status === 401) {
      await logTrace('upstream.auth_retry', { provider: 'codex', reason: 'HTTP 401' });
      let firstBody = '';
      try { firstBody = await resp.clone().text(); } catch { /* response body may not be cloneable */ }
      await logTrace('upstream.error_body', { provider: 'codex', attempt, status: 401, rawBody: firstBody });
      headers = await this.authManager.getHeaders(true);
      attempt++;
      resp = await send();
    }

    return resp;
  }

  /**
   * Handle Anthropic Messages request via Codex compute
   */
  public async *handleAnthropicMessages(
    req: AnthropicRequest,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<AnthropicEvent> {
    const effort = resolveAnthropicReasoning(req.model, req, this.reasoningConfig);
    const payload = CodexRequestAdapter.fromAnthropic(req, effort);
    const bodyStr = JSON.stringify(payload);

    const resp = await this.fetchWithAuth('/responses', {
      method: 'POST',
      body: bodyStr,
      signal: options?.signal
    });

    if (!resp.ok) {
      const errText = await resp.text();
      await logTrace('upstream.error_body', {
        provider: 'codex',
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        rawBody: errText
      });
      let errMsg = `Codex upstream returned HTTP ${resp.status}`;
      try {
        const parsed = JSON.parse(errText);
        errMsg += `: ${parsed.detail || parsed.message || errText}`;
      } catch {
        errMsg += `: ${errText}`;
      }
      throw new Error(errMsg);
    }

    if (!resp.body) {
      throw new Error('Codex upstream returned empty response body.');
    }

    const [streamForAdapter, streamForLog] = resp.body.tee();
    const capture = captureReadableStream(streamForLog, 'codex.responses.anthropic');
    yield* CodexStreamAdapter.toAnthropicStream(streamForAdapter, payload.model);
    await capture;
  }

  public validateAnthropicReasoning(req: AnthropicRequest): void {
    resolveAnthropicReasoning(req.model, req, this.reasoningConfig);
  }

  /**
   * Handle OpenAI Chat request via Codex compute
   */
  public async *handleOpenAIChat(
    req: OpenAIChatRequest,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<OpenAIChatChunk> {
    const effort = resolveOpenAIReasoning(req.model, req, this.reasoningConfig);
    const payload = CodexRequestAdapter.fromOpenAIChat(req, effort);
    const bodyStr = JSON.stringify(payload);

    const resp = await this.fetchWithAuth('/responses', {
      method: 'POST',
      body: bodyStr,
      signal: options?.signal
    });

    if (!resp.ok) {
      const errText = await resp.text();
      await logTrace('upstream.error_body', {
        provider: 'codex',
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        rawBody: errText
      });
      let errMsg = `Codex upstream returned HTTP ${resp.status}`;
      try {
        const parsed = JSON.parse(errText);
        errMsg += `: ${parsed.detail || parsed.message || errText}`;
      } catch {
        errMsg += `: ${errText}`;
      }
      throw new Error(errMsg);
    }

    if (!resp.body) {
      throw new Error('Codex upstream returned empty response body.');
    }

    const [streamForAdapter, streamForLog] = resp.body.tee();
    const capture = captureReadableStream(streamForLog, 'codex.responses.openai');
    yield* CodexStreamAdapter.toOpenAIChatStream(streamForAdapter, payload.model);
    await capture;
  }

  public validateOpenAIReasoning(req: OpenAIChatRequest): void {
    resolveOpenAIReasoning(req.model, req, this.reasoningConfig);
  }

  public getAccountStatus() {
    return {
      auth: this.authManager.getStatus(),
      lastConnectionCheck: this.lastConnectionCheck,
      lastUsage: this.lastUsage
    };
  }

  /** Read the Codex account's remaining usage windows from the ChatGPT usage endpoint. */
  public async refreshUsage(): Promise<CodexUsageResult> {
    const checkedAt = new Date().toISOString();
    try {
      const headers = await this.authManager.getHeaders(false);
      headers.Accept = 'application/json';
      const url = this.getUsageUrl();
      let response = await fetch(url, { method: 'GET', headers });
      if (response.status === 401) {
        const refreshedHeaders = await this.authManager.getHeaders(true);
        refreshedHeaders.Accept = 'application/json';
        response = await fetch(url, { method: 'GET', headers: refreshedHeaders });
      }

      if (!response.ok) {
        this.lastUsage = {
          status: 'unavailable',
          checkedAt,
          httpStatus: response.status,
          error: `Codex 用量接口返回 HTTP ${response.status}`
        };
        return this.lastUsage;
      }

      const payload = await response.json();
      const usage = normalizeCodexUsage(payload, checkedAt);
      if (usage.windows.length === 0) {
        this.lastUsage = {
          status: 'unavailable',
          checkedAt,
          error: '上游响应中没有可识别的额度窗口；接口字段可能已变化'
        };
        return this.lastUsage;
      }

      this.lastUsage = { status: 'available', ...usage };
    } catch (error) {
      this.lastUsage = {
        status: 'unavailable',
        checkedAt,
        error: sanitizeProbeError(error instanceof Error ? error.message : String(error))
      };
    }
    return this.lastUsage;
  }

  private getUsageUrl(): string {
    const base = new URL(this.baseURL);
    const pathname = base.pathname.replace(/\/+$/, '');
    if (pathname.includes('/backend-api')) {
      base.pathname = pathname.replace(/\/codex(?:\/.*)?$/, '') + '/wham/usage';
    } else if (/\/api\/codex$/.test(pathname)) {
      base.pathname = `${pathname}/usage`;
    } else if (/\/codex$/.test(pathname)) {
      base.pathname = `${pathname.slice(0, -'/codex'.length)}/api/codex/usage`;
    } else {
      base.pathname = `${pathname}/api/codex/usage`;
    }
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  /** Make a small live inference request to verify Codex credentials and routing. */
  public async checkConnection(model: string): Promise<{
    checkedAt: string;
    model: string;
    status: 'connected' | 'failed';
    httpStatus?: number;
    error?: string;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const payload = CodexRequestAdapter.fromOpenAIChat({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 16,
        stream: true
      });
      const resp = await this.fetchWithAuth('/responses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const responseText = await resp.text();
      if (!resp.ok) {
        const error = sanitizeProbeError(extractUpstreamMessage(responseText));
        this.lastConnectionCheck = { checkedAt, model, status: 'failed', httpStatus: resp.status, error };
      } else {
        const streamResult = inspectConnectionStream(responseText);
        this.lastConnectionCheck = streamResult.error
          ? { checkedAt, model, status: 'failed', httpStatus: resp.status, error: streamResult.error }
          : streamResult.completed
            ? { checkedAt, model, status: 'connected', httpStatus: resp.status }
            : { checkedAt, model, status: 'failed', httpStatus: resp.status, error: '上游返回 HTTP 2xx，但流中没有 response.completed 事件' };
      }
    } catch (error) {
      this.lastConnectionCheck = {
        checkedAt,
        model,
        status: 'failed',
        error: sanitizeProbeError(error instanceof Error ? error.message : String(error))
      };
    }
    return this.lastConnectionCheck;
  }

  /** Make one live upstream request to check whether a model accepts an effort value. */
  public async probeReasoningEffort(
    model: string,
    effort: CodexReasoningEffort
  ): Promise<{ status: 'accepted' | 'rejected' | 'failed'; httpStatus?: number; error?: string }> {
    const payload = CodexRequestAdapter.fromOpenAIChat({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 16,
      stream: true
    }, effort);

    try {
      const resp = await this.fetchWithAuth('/responses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const responseText = await resp.text();
      if (resp.ok) return { status: 'accepted', httpStatus: resp.status };

      const message = extractUpstreamMessage(responseText);
      const isEffortRejection = (resp.status === 400 || resp.status === 422) && /reasoning|effort/i.test(message);
      return {
        status: isEffortRejection ? 'rejected' : 'failed',
        httpStatus: resp.status,
        error: sanitizeProbeError(message)
      };
    } catch (error) {
      return {
        status: 'failed',
        error: sanitizeProbeError(error instanceof Error ? error.message : String(error))
      };
    }
  }

  /**
   * Set previously discovered models (e.g. from persistent cache)
   */
  public setDiscoveredModels(models: ModelListItem[]): void {
    this.discoveredModels = models;
  }

  /**
   * Discover Codex models directly from the upstream backend API,
   * falling back to models_cache.json if the API request fails.
   */
  public async discoverModels(): Promise<ModelListItem[]> {
    const models: ModelListItem[] = [];
    const seen = new Set<string>();
    let rawModels: Array<{ slug?: string; id?: string; display_name?: string; description?: string }> = [];

    // 1. Try querying upstream Codex /models API
    try {
      const resp = await this.fetchWithAuth('/models?client_version=0.162.1', { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json() as any;
        if (Array.isArray(data.models)) {
          rawModels = data.models;
        }
      } else {
        const errText = await resp.text();
        console.warn(`[CodexClient] Upstream /models API returned HTTP ${resp.status}: ${errText}`);
      }
    } catch (err: any) {
      console.warn(`[CodexClient] Failed to fetch models via API: ${err.message}`);
    }

    // 2. Fallback to local models_cache.json if API returned no models
    if (rawModels.length === 0 && fs.existsSync(this.modelsCachePath)) {
      try {
        const content = fs.readFileSync(this.modelsCachePath, 'utf8');
        const data = JSON.parse(content);
        if (Array.isArray(data.models)) {
          rawModels = data.models;
        }
      } catch (err: any) {
        console.warn('[CodexClient] Failed to parse models_cache.json:', err.message);
      }
    }

    // 3. Build ModelListItem with classification and without aliases/normalization
    for (const m of rawModels) {
      const id = m.slug || m.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        const category = id.includes('review') ? 'review' : 'chat';
        models.push({
          id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'openai-codex',
          category,
          display_name: m.display_name,
          description: m.description || m.display_name || `OpenAI Codex model ${id}`,
          ...reasoningMetadata(id, this.reasoningConfig)
        });
      }
    }

    this.discoveredModels = models;
    return models;
  }

  /**
   * List available Codex models
   */
  public async listModels(options: { forceRefresh?: boolean } = {}): Promise<ModelListItem[]> {
    if (!options.forceRefresh && this.discoveredModels) {
      return this.discoveredModels;
    }
    return this.discoverModels();
  }
}

export interface CodexUsageWindow {
  id: 'primary' | 'secondary';
  usedPercent: number;
  remainingPercent: number;
  windowSeconds?: number;
  resetAt?: string;
  resetAfterSeconds?: number;
}

export type CodexUsageResult =
  | {
      status: 'available';
      checkedAt: string;
      planType?: string;
      allowed?: boolean;
      limitReached?: boolean;
      windows: CodexUsageWindow[];
      availableResetCredits?: number;
    }
  | {
      status: 'unavailable';
      checkedAt: string;
      httpStatus?: number;
      error: string;
    };

function normalizeCodexUsage(payload: any, checkedAt: string): Omit<Extract<CodexUsageResult, { status: 'available' }>, 'status'> {
  const rateLimit = payload?.rate_limit ?? payload?.rateLimit ?? payload?.rate_limits?.rate_limit;
  const windows: CodexUsageWindow[] = [];
  for (const id of ['primary', 'secondary'] as const) {
    const raw = rateLimit?.[`${id}_window`] ?? rateLimit?.[`${id}Window`];
    if (!raw || typeof raw !== 'object') continue;
    const usedPercent = Number(raw.used_percent ?? raw.usedPercent);
    if (!Number.isFinite(usedPercent)) continue;
    const normalizedUsed = Math.max(0, Math.min(100, usedPercent));
    const windowSeconds = Number(raw.limit_window_seconds ?? raw.limitWindowSeconds ?? ((raw.window_duration_mins ?? raw.windowDurationMins) * 60));
    const resetAtValue = raw.reset_at ?? raw.resetAt ?? raw.resets_at ?? raw.resetsAt;
    const resetAtNumber = Number(resetAtValue);
    const resetAfter = Number(raw.reset_after_seconds ?? raw.resetAfterSeconds);
    windows.push({
      id,
      usedPercent: normalizedUsed,
      remainingPercent: 100 - normalizedUsed,
      ...(Number.isFinite(windowSeconds) && windowSeconds > 0 ? { windowSeconds } : {}),
      ...(typeof resetAtValue === 'string' && !/^\d+(?:\.\d+)?$/.test(resetAtValue) && Number.isFinite(Date.parse(resetAtValue))
        ? { resetAt: new Date(resetAtValue).toISOString() }
        : Number.isFinite(resetAtNumber) && resetAtNumber > 0
          ? { resetAt: new Date(resetAtNumber < 1e12 ? resetAtNumber * 1000 : resetAtNumber).toISOString() }
          : {}),
      ...(Number.isFinite(resetAfter) && resetAfter >= 0 ? { resetAfterSeconds: resetAfter } : {})
    });
  }

  const availableResetCredits = Number(payload?.rate_limit_reset_credits?.available_count ?? payload?.rateLimitResetCredits?.availableCount);
  return {
    checkedAt,
    ...(typeof payload?.plan_type === 'string' ? { planType: payload.plan_type } : typeof payload?.planType === 'string' ? { planType: payload.planType } : {}),
    ...(typeof rateLimit?.allowed === 'boolean' ? { allowed: rateLimit.allowed } : {}),
    ...(typeof rateLimit?.limit_reached === 'boolean' ? { limitReached: rateLimit.limit_reached } : {}),
    windows,
    ...(Number.isFinite(availableResetCredits) && availableResetCredits >= 0 ? { availableResetCredits } : {})
  };
}

function reasoningMetadata(model: string, config: CodexReasoningConfig): Partial<ModelListItem> {
  const profile = getCodexReasoningProfile(model, config);
  if (!profile) return {};
  return {
    reasoning_efforts: [...profile.efforts],
    ...(profile.default ? { reasoning_default: profile.default } : {})
  };
}

function extractUpstreamMessage(text: string): string {
  try {
    const parsed = JSON.parse(text);
    const payload = parsed?.error ?? parsed;
    if (typeof payload?.message === 'string') return payload.message;
    if (typeof payload?.detail === 'string') return payload.detail;
  } catch {
    // Keep plain-text upstream errors.
  }
  return text || 'Upstream rejected the request';
}

function sanitizeProbeError(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, '[upstream URL]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 300);
}

function inspectConnectionStream(text: string): { completed: boolean; error?: string } {
  let completed = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5).trim();
    if (!value || value === '[DONE]') continue;
    try {
      const event = JSON.parse(value);
      if (event.type === 'response.completed') completed = true;
      if (event.type === 'error' || event.type === 'response.failed') {
        const message = event.error?.message || event.message || 'Codex 上游返回错误事件';
        return { completed: false, error: sanitizeProbeError(String(message)) };
      }
    } catch {
      // Ignore non-JSON SSE data and keep looking for a terminal event.
    }
  }
  return { completed };
}
