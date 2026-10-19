import type {
  AnthropicRequest,
  OpenAIChatRequest,
  ModelListItem,
  ModelCategory,
  AnthropicEvent,
  OpenAIChatChunk,
  GoogleReasoningConfig,
  GooglePreparedReasoning,
  GoogleReasoningEffort,
  GoogleThinkingConfig,
  GoogleReasoningScope
} from '../../types.ts';
import { GoogleAccountPool } from './account-pool/pool.ts';
import type { AccountPoolConfig } from './account-pool/types.ts';
import { buildGoogleCloudCodePayload, ANTIGRAVITY_HEADERS } from './request-builder.ts';
import { parseGoogleStreamToAnthropic, parseGoogleStreamToOpenAI } from './sse-parser.ts';
import {
  canonicalGoogleModel,
  getGoogleReasoningProfile,
  googleReasoningMetadata,
  prepareGoogleAnthropicReasoning,
  prepareGoogleOpenAIReasoning
} from './reasoning.ts';
import { EventSourceParser } from '../../utils/event-source-parser.ts';
import { parseOpenAIChatRequest } from '../../protocol/ingress.ts';
import { logTrace } from '../../utils/logger.ts';
import { GOOGLE_QUOTA_ENDPOINTS, googleQuotaHeaders, parseGoogleQuotaGroups, parseGoogleQuotaPayload } from './quota.ts';

const GOOGLE_ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com'
];

const MODEL_DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_REQUEST_RETRY_DELAYS_MS = [250, 500];

function sanitizeProbeDetail(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(?:refresh_token|access_token|client_secret)\s*[=:]\s*[^,\s"}]+/gi, '[credential redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 180);
}

interface GoogleDiscoveredModel {
  displayName?: string;
  isInternal?: boolean;
  supportsThinking?: boolean;
  thinkingBudget?: number;
  minThinkingBudget?: number;
  quotaInfo?: {
    remainingFraction?: number | string;
    resetTime?: string;
  };
}

export type AntigravitySubscriptionPlan = 'free' | 'pro' | 'ultra' | 'ultra-lite' | 'unknown';

export interface AntigravitySubscription {
  plan: AntigravitySubscriptionPlan;
  tierId: string | null;
  tierName: string | null;
  description?: string;
}

export interface GoogleQuotaBucket {
  bucketId: string;
  displayName: string;
  window: string;
  remainingFraction: number | null;
  remainingPercent: number | null;
  resetTime?: string;
  available: boolean | null;
}

export interface GoogleQuotaGroup {
  displayName: string;
  description?: string;
  buckets: GoogleQuotaBucket[];
}

export interface GoogleAccountQuota {
  id: string;
  email: string;
  label?: string;
  projectId?: string;
  status: 'ok' | 'error';
  error?: string;
  checkedAt: string;
  subscription?: AntigravitySubscription;
  serverTimeOffsetMs?: number;
  source?: 'retrieveUserQuotaSummary';
  endpoint?: string;
  description?: string;
  groups?: GoogleQuotaGroup[];
}

export interface GoogleQuotaReport {
  object: 'google_quota_report';
  checkedAt: string;
  accounts: GoogleAccountQuota[];
}

interface GoogleModelDiscoveryResponse {
  models?: Record<string, GoogleDiscoveredModel>;
  tabModelIds?: string[];
  imageGenerationModelIds?: string[];
  audioTranscriptionModelIds?: string[];
}

export class GoogleProviderClient {
  private pool: GoogleAccountPool;
  private discoveredModels: ModelListItem[] | null = null;
  private modelsExpiresAt = 0;
  private discoveryInFlight: Promise<ModelListItem[]> | null = null;
  private reasoningConfig: GoogleReasoningConfig;
  private invalidReasoningScopes = new Set<string>();

  constructor(poolOrConfig?: GoogleAccountPool | (AccountPoolConfig & { reasoning?: GoogleReasoningConfig }) | string) {
    this.reasoningConfig = typeof poolOrConfig === 'object' && !(poolOrConfig instanceof GoogleAccountPool)
      ? poolOrConfig?.reasoning ?? { models: {} }
      : { models: {} };
    if (poolOrConfig instanceof GoogleAccountPool) {
      this.pool = poolOrConfig;
    } else if (typeof poolOrConfig === 'string') {
      this.pool = new GoogleAccountPool({ accountsPath: poolOrConfig });
    } else {
      this.pool = new GoogleAccountPool(poolOrConfig);
    }
  }

  public getPool(): GoogleAccountPool {
    return this.pool;
  }

  private async doFetch(
    payload: any,
    accessToken: string,
    allowedEndpoints: ReadonlySet<string> = new Set(GOOGLE_ENDPOINTS),
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const endpoint = GOOGLE_ENDPOINTS.find(candidate => allowedEndpoints.has(candidate));
    if (!endpoint) throw new Error('No permitted Google Cloud Code endpoint');

    const headers: Record<string, string> = {
      ...ANTIGRAVITY_HEADERS,
      Authorization: `Bearer ${accessToken}`
    };

    // Attach stable session ID for server-side prompt caching continuity
    const sessionId = payload?.request?.sessionId;
    if (sessionId) {
      headers['X-Machine-Session-Id'] = sessionId;
    }

    // Attach interleaved thinking header for Claude thinking models
    const model = (payload?.model || '').toLowerCase();
    if (model.includes('claude') && (payload?.request?.generationConfig?.thinkingConfig || payload?.request?.thinking)) {
      headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
    }

    const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) {
      const errText = await response.text();
      throw Object.assign(new Error(`Google Cloud Code error (${response.status}) at ${endpoint}: ${errText}`), {
        statusCode: response.status
      });
    }
    if (!response.body) throw new Error(`Google Cloud Code response body is null at ${endpoint}`);
    return response.body as ReadableStream<Uint8Array>;
  }

  private async doFetchWithRetry(
    payload: any,
    accessToken: string,
    allowedEndpoints: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const capacityBackoffDelays = [1000, 2000, 4000];
    let capacityRetries = 0;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.doFetch(payload, accessToken, allowedEndpoints, signal);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        const errMsg = error instanceof Error ? error.message : String(error);
        const isCapacity =
          (status === 429 || status === 503 || status === 529) &&
          /capacity|overload|RESOURCE_EXHAUSTED/i.test(errMsg) &&
          !/quota will reset after/i.test(errMsg);

        if (isCapacity && capacityRetries < capacityBackoffDelays.length) {
          const delay = capacityBackoffDelays[capacityRetries++];
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        const retryable = status === undefined || status === 408 || status === 429 || (status !== undefined && status >= 500);
        if (!retryable || attempt >= GOOGLE_REQUEST_RETRY_DELAYS_MS.length) throw error;
        await new Promise(resolve => setTimeout(resolve, GOOGLE_REQUEST_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  /**
   * Select one account and retry transient upstream failures on the same endpoint.
   */
  private async fetchStream(
    payload: any,
    modelId: string,
    prepared?: GooglePreparedReasoning,
    signal?: AbortSignal
  ): Promise<{ stream: ReadableStream<Uint8Array>; accountId: string }> {
    const eligibleIds = prepared?.allowedScopes
      ? new Set(prepared.allowedScopes.filter(scope => !this.invalidReasoningScopes.has(this.scopeKey(modelId, prepared, scope))).map(scope => scope.accountId))
      : undefined;
    const account = this.pool.selectAccount(eligibleIds).account;
    if (!account) {
      throw Object.assign(new Error(`No eligible Google account is available for ${modelId}`), { statusCode: 503 });
    }
    const { accessToken, projectId } = await this.pool.getAccessToken(account);
    payload.project = projectId;
    const allowedEndpoints = prepared?.allowedScopes
      ? new Set(prepared.allowedScopes
          .filter(scope => scope.accountId === account.id && scope.projectId === projectId)
          .filter(scope => !this.invalidReasoningScopes.has(this.scopeKey(modelId, prepared, scope)))
          .map(scope => scope.endpoint))
      : new Set(GOOGLE_ENDPOINTS);
    if (allowedEndpoints.size === 0) throw new Error(`No verified Google reasoning endpoint for ${modelId} on selected account`);
    try {
      const stream = await this.doFetchWithRetry(payload, accessToken, allowedEndpoints, signal);
      return { stream, accountId: account.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (prepared?.allowedScopes && /Google Cloud Code error \((400|422)\)/.test(message) && /thinking|budget|level/i.test(message)) {
        for (const scope of prepared.allowedScopes.filter(item => item.accountId === account.id)) {
          this.invalidReasoningScopes.add(this.scopeKey(modelId, prepared, scope));
        }
      }
      throw error;
    }
  }

  /**
   * Handle Anthropic Messages Request
   */
  private scopeKey(model: string, prepared: GooglePreparedReasoning, scope: GoogleReasoningScope): string {
    return `${model}:${prepared.effort}:${scope.accountId}:${scope.projectId}:${scope.endpoint}`;
  }

  public prepareAnthropicReasoning(req: AnthropicRequest): GooglePreparedReasoning {
    return prepareGoogleAnthropicReasoning(req, this.reasoningConfig);
  }

  public prepareOpenAIReasoning(req: OpenAIChatRequest, internalBudget?: number): GooglePreparedReasoning {
    return prepareGoogleOpenAIReasoning(req, this.reasoningConfig, internalBudget);
  }

  public updateReasoningProfile(model: string, profile?: import('../../types.ts').GoogleReasoningProfile): void {
    const canonical = canonicalGoogleModel(model);
    if (profile) this.reasoningConfig.models[canonical] = profile;
    else delete this.reasoningConfig.models[canonical];
    this.invalidReasoningScopes.clear();
    if (this.discoveredModels) {
      this.discoveredModels = this.discoveredModels.map(item => {
        if (item.id !== canonical) return item;
        const { reasoning_efforts, reasoning_control, reasoning_verification,
          supports_thinking_budget, supports_thinking_disable, ...withoutReasoning } = item;
        return { ...withoutReasoning, ...googleReasoningMetadata(item.id, this.reasoningConfig) };
      });
    }
  }

  public getReasoningProfile(model: string) {
    return getGoogleReasoningProfile(model, this.reasoningConfig);
  }

  public assertPreparedAvailability(prepared: GooglePreparedReasoning): void {
    if (!prepared.allowedScopes) return;
    const eligible = this.pool.listAccounts().some(account =>
      account.enabled !== false && !account.isInvalid &&
      prepared.allowedScopes!.some(scope =>
        scope.accountId === account.id &&
        scope.projectId === account.projectId &&
        !this.invalidReasoningScopes.has(this.scopeKey(prepared.model, prepared, scope))
      )
    );
    if (!eligible) {
      throw Object.assign(new Error(`No available Google account has a verified '${prepared.effort}' reasoning configuration for ${prepared.model}`), { statusCode: 503 });
    }
  }

  public async probeReasoningEffort(
    model: string,
    effort: GoogleReasoningEffort,
    thinkingConfig: GoogleThinkingConfig,
    maxOutputTokens: number
  ): Promise<{ status: 'accepted' | 'rejected' | 'failed'; scopes: GoogleReasoningScope[]; httpStatus?: number; error?: string }> {
    const canonical = canonicalGoogleModel(model);
    const endpoint = GOOGLE_ENDPOINTS[0];
    const scopes: GoogleReasoningScope[] = [];
    const statuses: Array<'rejected' | 'failed'> = [];
    const errors: string[] = [];
    let lastHttpStatus: number | undefined;
    const accounts = this.pool.listAccounts().filter(account => account.enabled !== false && !account.isInvalid && Boolean(account.refreshToken));
    if (accounts.length === 0) return { status: 'failed', scopes, error: 'No enabled Google account is available' };

    for (const account of accounts) {
      try {
        const { accessToken, projectId } = await this.pool.getAccessToken(account);
        const prepared: GooglePreparedReasoning = {
          model: canonical, thinkingConfig, maxOutputTokens, effort, source: 'admin-probe'
        };
        const payload = buildGoogleCloudCodePayload({
          model: canonical, max_tokens: maxOutputTokens,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
        }, projectId, prepared);
        const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { ...ANTIGRAVITY_HEADERS, Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(payload)
        });
        lastHttpStatus = response.status;
        const body = await response.text();
        if (!response.ok) {
          const rejected = (response.status === 400 || response.status === 422) && /thinking|budget|level/i.test(body);
          statuses.push(rejected ? 'rejected' : 'failed');
          errors.push(`HTTP ${response.status}: ${sanitizeProbeDetail(body)}`);
          continue;
        }
        let hasCandidate = false;
        let streamError = '';
        const probeParser = new EventSourceParser({
          onEvent: (sse) => {
            if (!sse.data) return;
            try {
              const event = JSON.parse(sse.data);
              const inner = event.response || event;
              if (event.error || inner.error) streamError = JSON.stringify(event.error || inner.error);
              if (inner.candidates?.[0]?.content?.parts?.some((part: any) => Boolean((part.text && !part.thought) || part.functionCall))) hasCandidate = true;
              if (inner.candidates?.[0]?.finishReason && inner.candidates[0].finishReason !== 'STOP') {
                streamError = `finishReason=${inner.candidates[0].finishReason}`;
              }
            } catch {
              // Ignore non-JSON SSE sentinels.
            }
          }
        });
        probeParser.feed(body);
        probeParser.flush();

        if (hasCandidate && !streamError) {
          scopes.push({ accountId: account.id, projectId, endpoint, checkedAt: new Date().toISOString() });
        } else {
          statuses.push('failed');
          errors.push(sanitizeProbeDetail(streamError || 'PA stream completed without model output'));
        }
      } catch (error) {
        statuses.push('failed');
        errors.push(sanitizeProbeDetail(error instanceof Error ? error.message : String(error)));
      }
    }
    return {
      status: scopes.length ? 'accepted' : statuses.every(status => status === 'rejected') ? 'rejected' : 'failed',
      scopes,
      ...(lastHttpStatus ? { httpStatus: scopes.length ? 200 : lastHttpStatus } : {}),
      ...(errors.length ? { error: errors[0] } : {})
    };
  }

  async *handleAnthropicMessages(
    req: AnthropicRequest,
    prepared = this.prepareAnthropicReasoning(req),
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<AnthropicEvent> {
    const targetModel = prepared.model;
    const normalizedReq = {
      ...req,
      model: targetModel
    };
    const payload = buildGoogleCloudCodePayload(normalizedReq, '', prepared);
    await logTrace('google.reasoning.resolved', {
      model: req.model, upstreamModel: targetModel, source: prepared.source,
      effort: prepared.effort, thinkingConfig: prepared.thinkingConfig, maxOutputTokens: prepared.maxOutputTokens
    });
    const upstream = await this.fetchStream(payload, targetModel, prepared, options?.signal);
    try {
      yield* parseGoogleStreamToAnthropic(upstream.stream, req.model, req.tools);
    } catch (error) {
      this.recordStreamFailure(targetModel, prepared, upstream.accountId, error);
      throw error;
    }
  }

  /**
   * Handle OpenAI Chat Request
   */
  async *handleOpenAIChat(
    req: OpenAIChatRequest,
    options: { thinkingBudget?: number; prepared?: GooglePreparedReasoning; signal?: AbortSignal } = {}
  ): AsyncGenerator<OpenAIChatChunk> {
    const prepared = options.prepared ?? this.prepareOpenAIReasoning(req, options.thinkingBudget);
    const targetModel = prepared.model;
    const ir = parseOpenAIChatRequest({ ...req, model: targetModel });
    const payload = buildGoogleCloudCodePayload(ir, '', prepared);
    await logTrace('google.reasoning.resolved', {
      model: req.model, upstreamModel: targetModel, source: prepared.source,
      effort: prepared.effort, thinkingConfig: prepared.thinkingConfig, maxOutputTokens: prepared.maxOutputTokens
    });
    const upstream = await this.fetchStream(payload, targetModel, prepared, options.signal);
    try {
      yield* parseGoogleStreamToOpenAI(upstream.stream, req.model, req.tools as any);
    } catch (error) {
      this.recordStreamFailure(targetModel, prepared, upstream.accountId, error);
      throw error;
    }
  }

  private recordStreamFailure(
    model: string, prepared: GooglePreparedReasoning, accountId: string, error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    if (prepared.allowedScopes && /thinking|budget|level/i.test(message)) {
      for (const scope of prepared.allowedScopes.filter(item => item.accountId === accountId)) {
        this.invalidReasoningScopes.add(this.scopeKey(model, prepared, scope));
      }
    }
  }

  /**
   * Set previously discovered models (e.g. from persistent cache)
   */
  public setDiscoveredModels(models: ModelListItem[]): void {
    this.discoveredModels = models;
  }

  /**
   * List Google supported models
   */
  async listModels(options: { forceRefresh?: boolean } = {}): Promise<ModelListItem[]> {
    if (!options.forceRefresh && this.discoveredModels) {
      return this.discoveredModels;
    }
    if (this.discoveryInFlight) return this.discoveryInFlight;

    this.discoveryInFlight = this.discoverModels();
    try {
      const models = await this.discoveryInFlight;
      this.discoveredModels = models;
      return models;
    } finally {
      this.discoveryInFlight = null;
    }
  }

  public async discoverModels(): Promise<ModelListItem[]> {
    const accounts = this.pool.listAccounts().filter(account =>
      account.enabled !== false && !account.isInvalid && Boolean(account.refreshToken)
    );
    if (accounts.length === 0) {
      throw new Error('No enabled Google account is available for model discovery');
    }

    const discovered = new Map<string, ModelListItem>();
    const errors: unknown[] = [];

    await Promise.all(accounts.map(async account => {
      try {
        const { accessToken, projectId } = await this.pool.getAccessToken(account);
        const response = await fetch(`${GOOGLE_ENDPOINTS[0]}/v1internal:fetchAvailableModels`, {
          method: 'POST',
          headers: {
            ...ANTIGRAVITY_HEADERS,
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ project: projectId })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Google model discovery failed (${response.status}): ${errorText}`);
        }

        const result = await response.json() as GoogleModelDiscoveryResponse;
        if (!result.models || typeof result.models !== 'object') {
          throw new Error('Google model discovery response did not contain a models map');
        }

        const tabModels = new Set(result.tabModelIds || []);
        const imageModels = new Set(result.imageGenerationModelIds || []);
        const audioModels = new Set(result.audioTranscriptionModelIds || []);
        const commandModels = new Set(result.commandModelIds || []);

        for (const [id, model] of Object.entries(result.models)) {
          let category: ModelCategory = 'chat';
          if (imageModels.has(id)) {
            category = 'image';
          } else if (audioModels.has(id)) {
            category = 'audio';
          } else if (tabModels.has(id) || id.startsWith('tab_')) {
            category = 'code_completion';
          } else if (model.isInternal || id.startsWith('chat_')) {
            category = 'internal';
          } else if (commandModels.has(id)) {
            category = 'command';
          }

          const rawFraction = model.quotaInfo?.remainingFraction;
          const parsedFraction = rawFraction === undefined || rawFraction === null ? Number.NaN : Number(rawFraction);
          const remainingFraction = Number.isFinite(parsedFraction) ? parsedFraction : undefined;
          const candidate: ModelListItem = {
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'google-antigravity',
            category,
            description: model.displayName || `Google Cloud Code PA (${id})`,
            ...(model.displayName ? { display_name: model.displayName } : {}),
            ...(model.supportsThinking !== undefined ? { supports_thinking: model.supportsThinking } : {}),
            ...(typeof model.thinkingBudget === 'number' ? { thinking_budget: model.thinkingBudget } : {}),
            ...(typeof model.minThinkingBudget === 'number' ? { min_thinking_budget: model.minThinkingBudget } : {}),
            ...googleReasoningMetadata(id, this.reasoningConfig),
            ...(remainingFraction !== undefined || model.quotaInfo?.resetTime
              ? { quota_info: {
                  ...(remainingFraction !== undefined ? { remaining_fraction: remainingFraction } : {}),
                  ...(model.quotaInfo?.resetTime ? { reset_time: model.quotaInfo.resetTime } : {})
                } }
              : {})
          };
          const existing = discovered.get(id);
          if (!existing || (candidate.quota_info?.remaining_fraction ?? -1) > (existing.quota_info?.remaining_fraction ?? -1)) {
            discovered.set(id, candidate);
          }
        }
      } catch (error) {
        errors.push(error);
      }
    }));

    if (discovered.size === 0) {
      const reason = errors[0] instanceof Error ? errors[0].message : 'No models were returned';
      throw new Error(`Google model discovery failed: ${reason}`);
    }

    if (errors.length > 0) {
      console.warn(`[GoogleProvider] Model discovery succeeded for some accounts; ${errors.length} account(s) failed`);
    }

    return [...discovered.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** CPA queries subscription metadata on daily with the same Hub identity as quotas. */
  private async fetchSubscriptionPlan(accessToken: string): Promise<AntigravitySubscription | undefined> {
    const res = await fetch(`${GOOGLE_QUOTA_ENDPOINTS[0]}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: googleQuotaHeaders(accessToken),
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return undefined;
    const data = parseGoogleQuotaPayload(await res.json());
    const paidTier = data?.paidTier ?? data?.paid_tier;
    const tier = paidTier?.id ? paidTier : data?.currentTier ?? data?.current_tier;
    if (!tier?.id && !tier?.name) return undefined;
    const plans: Record<string, AntigravitySubscriptionPlan> = {
      'g1-ultra-tier': 'ultra', 'g1-ultra-lite-tier': 'ultra-lite', 'g1-pro-tier': 'pro',
      'free-tier': 'free', 'standard-tier': 'free'
    };
    return { plan: plans[tier.id] || 'unknown', tierId: tier.id || null, tierName: tier.name || null,
      ...(typeof tier.description === 'string' ? { description: tier.description } : {}) };
  }

  /** First non-empty valid pool response wins; never merge pools from different hosts. */
  private async fetchQuotaSummary(accessToken: string, projectId: string): Promise<{
    groups: GoogleQuotaGroup[];
    description?: string;
    endpoint: string;
    serverTimeOffsetMs?: number;
  }> {
    if (!projectId?.trim()) throw new Error('Google quota query requires a project ID');
    let lastError = 'No valid quota groups';
    let lastSuccessfulEndpoint: string | undefined;
    for (const endpoint of GOOGLE_QUOTA_ENDPOINTS) {
      try {
        const res = await fetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
          method: 'POST',
          headers: googleQuotaHeaders(accessToken),
          body: JSON.stringify({ project: projectId }),
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
        lastSuccessfulEndpoint = endpoint;
        const data = parseGoogleQuotaPayload(await res.json());
        const groups = parseGoogleQuotaGroups(data);
        if (!groups.length) { lastError = '上游未提供有效算力池窗口'; continue; }
        const serverTime = Date.parse(res.headers.get('date') || '');
        return {
          groups, endpoint,
          ...(typeof data?.description === 'string' ? { description: data.description } : {}),
          ...(Number.isFinite(serverTime) ? { serverTimeOffsetMs: serverTime - Date.now() } : {})
        };
      } catch (error) {
        lastError = sanitizeProbeDetail(error instanceof Error ? error.message : String(error));
      }
    }
    // CPA treats successful-but-empty responses as unknown data, not as full quota.
    if (lastSuccessfulEndpoint) return { groups: [], endpoint: lastSuccessfulEndpoint };
    throw new Error(`Google quota query failed across all endpoints: ${lastError}`);
  }

  public async fetchQuota(targetAccountId?: string): Promise<GoogleQuotaReport> {
    const allAccounts = this.pool.listAccounts();
    const candidateAccounts = targetAccountId
      ? allAccounts.filter(a => a.id === targetAccountId || a.email.toLowerCase() === targetAccountId.toLowerCase())
      : allAccounts.filter(account => account.enabled !== false && !account.isInvalid && Boolean(account.refreshToken));

    const accountQuotas: GoogleAccountQuota[] = [];
    const nowIso = new Date().toISOString();

    for (const account of candidateAccounts) {
      try {
        const { accessToken, projectId } = await this.pool.getAccessToken(account);

        const [subscription, quotaResult] = await Promise.all([
          this.fetchSubscriptionPlan(accessToken).catch(() => undefined),
          this.fetchQuotaSummary(accessToken, projectId)
        ]);

        accountQuotas.push({
          id: account.id,
          email: account.email,
          label: account.label,
          projectId,
          status: 'ok',
          checkedAt: new Date().toISOString(),
          subscription,
          serverTimeOffsetMs: quotaResult.serverTimeOffsetMs,
          source: 'retrieveUserQuotaSummary',
          endpoint: quotaResult.endpoint,
          description: quotaResult.description,
          groups: quotaResult.groups
        });
      } catch (err: any) {
        accountQuotas.push({
          id: account.id,
          email: account.email,
          label: account.label,
          projectId: account.projectId,
          status: 'error',
          error: sanitizeProbeDetail(err.message || String(err)),
          checkedAt: new Date().toISOString()
        });
      }
    }

    return {
      object: 'google_quota_report',
      checkedAt: nowIso,
      accounts: accountQuotas
    };
  }
}
