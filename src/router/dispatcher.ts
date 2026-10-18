import fs from 'node:fs';
import path from 'node:path';
import type {
  GatewayConfig,
  AnthropicRequest,
  OpenAIChatRequest,
  AnthropicEvent,
  OpenAIChatChunk,
  ModelListItem,
  ModelDiffEntry,
  ModelRefreshResult,
  ModelsCacheData,
  ProviderId,
  GooglePreparedReasoning,
  GoogleReasoningEffort,
  GoogleReasoningProfile,
  GoogleThinkingConfig,
  GoogleReasoningScope
} from '../types.ts';
import { GoogleProviderClient } from '../providers/google/client.ts';
import { CodexProviderClient } from '../providers/codex/client.ts';
import { CodexRequestAdapter } from '../providers/codex/request-adapter.ts';
import { canonicalGoogleModel } from '../providers/google/reasoning.ts';
import { logTrace } from '../utils/logger.ts';

function computeModelDiff(oldModels: ModelListItem[], newModels: ModelListItem[]): ModelDiffEntry {
  const oldMap = new Map(oldModels.map(m => [m.id, m]));
  const newMap = new Map(newModels.map(m => [m.id, m]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [id, m] of newMap.entries()) {
    if (!oldMap.has(id)) {
      added.push(id);
    } else {
      const old = oldMap.get(id)!;
      const diffProps =
        old.category !== m.category ||
        old.display_name !== m.display_name ||
        old.description !== m.description ||
        old.supports_thinking !== m.supports_thinking ||
        old.thinking_budget !== m.thinking_budget ||
        old.min_thinking_budget !== m.min_thinking_budget ||
        old.quota_info?.remaining_fraction !== m.quota_info?.remaining_fraction ||
        JSON.stringify(old.reasoning_efforts) !== JSON.stringify(m.reasoning_efforts);
      if (diffProps) {
        modified.push(id);
      }
    }
  }

  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      removed.push(id);
    }
  }

  return { added, removed, modified };
}

export class Dispatcher {
  private config: GatewayConfig;
  private googleClient: GoogleProviderClient | null = null;
  private codexClient: CodexProviderClient | null = null;
  private googleModelIds = new Set<string>();
  private codexModelIds = new Set<string>();
  private modelsCachePath: string;
  private updatedAt: string = '';

  constructor(config: GatewayConfig) {
    this.config = config;
    this.modelsCachePath = path.resolve('./data/models-cache.json');

    if (config.providers.google?.enabled) {
      this.googleClient = new GoogleProviderClient({
        accountsPath: config.providers.google.accountsPath,
        autoReload: config.providers.google.accountPool?.autoReload,
        reasoning: config.providers.google.reasoning
      });
    }

    if (config.providers.codex?.enabled) {
      this.codexClient = new CodexProviderClient(
        config.providers.codex.authPath,
        config.providers.codex.baseURL,
        config.providers.codex.modelsCachePath,
        config.providers.codex.reasoning
      );
    }

    this.loadModelsCache();
  }

  private loadModelsCache(): void {
    if (!fs.existsSync(this.modelsCachePath)) return;
    try {
      const raw = fs.readFileSync(this.modelsCachePath, 'utf8');
      const data = JSON.parse(raw) as ModelsCacheData;
      if (data && typeof data === 'object') {
        this.updatedAt = data.updatedAt || '';
        if (Array.isArray(data.google) && this.googleClient) {
          this.googleClient.setDiscoveredModels(data.google);
          this.googleModelIds = new Set(data.google.map(m => m.id));
        }
        if (Array.isArray(data.codex) && this.codexClient) {
          this.codexClient.setDiscoveredModels(data.codex);
          this.codexModelIds = new Set(data.codex.map(m => m.id));
        }
      }
    } catch (err: any) {
      console.warn(`[Dispatcher] Failed to read models cache from ${this.modelsCachePath}: ${err.message}`);
    }
  }

  private saveModelsCache(googleModels: ModelListItem[], codexModels: ModelListItem[], updatedAt: string): void {
    try {
      const dir = path.dirname(this.modelsCachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload: ModelsCacheData = {
        updatedAt,
        google: googleModels,
        codex: codexModels
      };
      fs.writeFileSync(this.modelsCachePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err: any) {
      console.error(`[Dispatcher] Failed to write models cache to ${this.modelsCachePath}: ${err.message}`);
    }
  }

  public getUpdatedAt(): string {
    return this.updatedAt;
  }

  /**
   * Determine target provider ('google' | 'codex') based on model name and routing rules.
   * Prefix or keyword heuristic matching is strictly disabled.
   */
  resolveProvider(modelName: string): ProviderId {
    const trimmed = (modelName || '').trim();
    if (!trimmed) {
      throw new Error('Model name cannot be empty');
    }

    // 1. Explicit routing configuration in config.routes
    const configured = this.config.routes[trimmed];
    if (configured) {
      return configured;
    }

    // 2. Exact match in discovered Google models
    if (this.googleModelIds.has(trimmed)) {
      return 'google';
    }

    // 3. Exact match in discovered Codex models
    if (this.codexModelIds.has(trimmed)) {
      return 'codex';
    }

    // No heuristic prefix or keyword matching!
    throw new Error(
      `Model '${modelName}' is not routed to any enabled provider. ` +
      `Please configure it in 'routes' or refresh model discovery.`
    );
  }

  /**
   * Dispatch Anthropic Messages request
   */
  async *dispatchAnthropic(
    req: AnthropicRequest,
    prepared?: GooglePreparedReasoning,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<AnthropicEvent> {
    await this.ensureModelsLoaded();
    const provider = prepared ? 'google' : this.resolveProvider(req.model);
    await logTrace('routing.selected', { protocol: 'anthropic-messages', model: req.model, provider });

    if (provider === 'google') {
      if (!this.googleClient) {
        throw new Error('Google Provider is not enabled or configured.');
      }
      yield* this.googleClient.handleAnthropicMessages(req, prepared, options);
    } else if (provider === 'codex') {
      if (!this.codexClient) {
        throw new Error('Codex Provider is not enabled or configured.');
      }
      yield* this.codexClient.handleAnthropicMessages(req, options);
    }
  }

  public validateAnthropicReasoning(req: AnthropicRequest): void {
    if (this.resolveProvider(req.model) === 'codex') this.codexClient?.validateAnthropicReasoning(req);
    else this.googleClient?.prepareAnthropicReasoning(req);
  }

  public async prepareAnthropicReasoning(req: AnthropicRequest): Promise<GooglePreparedReasoning | undefined> {
    await this.ensureModelsLoaded();
    if (this.resolveProvider(req.model) === 'google') {
      if (!this.googleClient) throw new Error('Google Provider is not enabled or configured.');
      const prepared = this.googleClient.prepareAnthropicReasoning(req);
      this.googleClient.assertPreparedAvailability(prepared);
      return prepared;
    }
    this.codexClient?.validateAnthropicReasoning(req);
    return undefined;
  }

  /**
   * Dispatch OpenAI Chat request
   */
  async *dispatchOpenAI(
    req: OpenAIChatRequest,
    options: { googleThinkingBudget?: number; prepared?: GooglePreparedReasoning; signal?: AbortSignal } = {}
  ): AsyncGenerator<OpenAIChatChunk> {
    await this.ensureModelsLoaded();
    const provider = options.prepared ? 'google' : this.resolveProvider(req.model);
    await logTrace('routing.selected', { protocol: 'openai-chat-completions', model: req.model, provider });

    if (provider === 'google') {
      if (!this.googleClient) {
        throw new Error('Google Provider is not enabled or configured.');
      }
      yield* this.googleClient.handleOpenAIChat(req, {
        thinkingBudget: options.googleThinkingBudget,
        prepared: options.prepared,
        signal: options.signal
      });
    } else if (provider === 'codex') {
      if (!this.codexClient) {
        throw new Error('Codex Provider is not enabled or configured.');
      }
      yield* this.codexClient.handleOpenAIChat(req, options);
    }
  }

  public validateOpenAIReasoning(req: OpenAIChatRequest): void {
    if (this.resolveProvider(req.model) === 'codex') this.codexClient?.validateOpenAIReasoning(req);
    else this.googleClient?.prepareOpenAIReasoning(req);
  }

  public async prepareOpenAIReasoning(req: OpenAIChatRequest): Promise<GooglePreparedReasoning | undefined> {
    await this.ensureModelsLoaded();
    if (this.resolveProvider(req.model) === 'google') {
      if (!this.googleClient) throw new Error('Google Provider is not enabled or configured.');
      const prepared = this.googleClient.prepareOpenAIReasoning(req);
      this.googleClient.assertPreparedAvailability(prepared);
      return prepared;
    }
    this.codexClient?.validateOpenAIReasoning(req);
    return undefined;
  }

  /**
   * Aggregate all models from enabled providers (using persistent/memory cache without auto-expiry)
   */
  async listAllModels(): Promise<ModelListItem[]> {
    const models: ModelListItem[] = [];
    const seen = new Set<string>();

    if (this.googleClient) {
      try {
        const gModels = await this.googleClient.listModels();
        this.googleModelIds = new Set(gModels.map(model => model.id));
        for (const m of gModels) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            models.push(m);
          }
        }
      } catch (err: any) {
        console.warn('[Dispatcher] Failed to fetch Google models:', err.message);
      }
    }

    if (this.codexClient) {
      try {
        const cModels = await this.codexClient.listModels();
        this.codexModelIds = new Set(cModels.map(model => model.id));
        for (const m of cModels) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            models.push(m);
          }
        }
      } catch (err: any) {
        console.warn('[Dispatcher] Failed to fetch Codex models:', err.message);
      }
    }

    if (!this.updatedAt && models.length > 0) {
      this.updatedAt = new Date().toISOString();
      const g = models.filter(m => m.owned_by === 'google-antigravity');
      const c = models.filter(m => m.owned_by === 'openai-codex');
      this.saveModelsCache(g, c, this.updatedAt);
    }

    return models;
  }

  /**
   * Manually refresh models from upstream providers.
   * Compares with cached models, persists only if changes are detected, and reports exact diffs.
   */
  public async refreshModels(provider: 'all' | 'google' | 'codex' = 'all'): Promise<ModelRefreshResult> {
    const changes: ModelRefreshResult['changes'] = {};
    let hasChanges = false;

    let currentGoogleModels: ModelListItem[] = [];
    let currentCodexModels: ModelListItem[] = [];
    if (this.googleClient) {
      currentGoogleModels = await this.googleClient.listModels();
    }
    if (this.codexClient) {
      currentCodexModels = await this.codexClient.listModels();
    }

    let newGoogleModels = currentGoogleModels;
    let newCodexModels = currentCodexModels;

    if ((provider === 'all' || provider === 'google') && this.googleClient) {
      newGoogleModels = await this.googleClient.discoverModels();
      const diff = computeModelDiff(currentGoogleModels, newGoogleModels);
      changes.google = diff;
      if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
        hasChanges = true;
      }
    }

    if ((provider === 'all' || provider === 'codex') && this.codexClient) {
      newCodexModels = await this.codexClient.discoverModels();
      const diff = computeModelDiff(currentCodexModels, newCodexModels);
      changes.codex = diff;
      if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
        hasChanges = true;
      }
    }

    if (hasChanges || !this.updatedAt) {
      this.updatedAt = new Date().toISOString();
      if (this.googleClient) {
        this.googleClient.setDiscoveredModels(newGoogleModels);
        this.googleModelIds = new Set(newGoogleModels.map(m => m.id));
      }
      if (this.codexClient) {
        this.codexClient.setDiscoveredModels(newCodexModels);
        this.codexModelIds = new Set(newCodexModels.map(m => m.id));
      }
      this.saveModelsCache(newGoogleModels, newCodexModels, this.updatedAt);
    }

    const summaryParts: string[] = [];
    if (changes.google) {
      const g = changes.google;
      if (g.added.length === 0 && g.removed.length === 0 && g.modified.length === 0) {
        summaryParts.push('Google: 无更新条目');
      } else {
        const parts: string[] = [];
        if (g.added.length) parts.push(`新增 ${g.added.length} 个 (${g.added.join(', ')})`);
        if (g.removed.length) parts.push(`移除 ${g.removed.length} 个 (${g.removed.join(', ')})`);
        if (g.modified.length) parts.push(`变更 ${g.modified.length} 个 (${g.modified.join(', ')})`);
        summaryParts.push(`Google: ${parts.join('，')}`);
      }
    }
    if (changes.codex) {
      const c = changes.codex;
      if (c.added.length === 0 && c.removed.length === 0 && c.modified.length === 0) {
        summaryParts.push('Codex: 无更新条目');
      } else {
        const parts: string[] = [];
        if (c.added.length) parts.push(`新增 ${c.added.length} 个 (${c.added.join(', ')})`);
        if (c.removed.length) parts.push(`移除 ${c.removed.length} 个 (${c.removed.join(', ')})`);
        if (c.modified.length) parts.push(`变更 ${c.modified.length} 个 (${c.modified.join(', ')})`);
        summaryParts.push(`Codex: ${parts.join('，')}`);
      }
    }

    const summary = hasChanges
      ? `已检测到模型更新并保存至缓存：${summaryParts.join('；')}`
      : `模型列表无更新条目，保持现有缓存：${summaryParts.join('；')}`;

    const allModels = await this.listAllModels();

    return {
      updated: hasChanges,
      updatedAt: this.updatedAt,
      changes,
      summary,
      counts: {
        total: allModels.length,
        google: newGoogleModels.length,
        codex: newCodexModels.length
      },
      data: allModels
    };
  }

  public async refreshGoogleModels(): Promise<ModelListItem[]> {
    const res = await this.refreshModels('google');
    return res.data.filter(m => m.owned_by === 'google-antigravity');
  }

  private async ensureModelsLoaded(): Promise<void> {
    if (this.googleModelIds.size > 0 || this.codexModelIds.size > 0) {
      return;
    }
    try {
      await this.listAllModels();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[Dispatcher] Initial model loading failed: ${reason}`);
    }
  }

  public getGoogleClient(): GoogleProviderClient | null {
    return this.googleClient;
  }

  public getCodexClient(): CodexProviderClient | null {
    return this.codexClient;
  }

  public async probeCodexReasoningEffort(model: string, effort: import('../types.ts').CodexReasoningEffort) {
    if (this.resolveProvider(model) !== 'codex') {
      throw new Error(`Model '${model}' is not routed to the Codex provider`);
    }
    if (!this.codexClient) throw new Error('Codex Provider is not enabled or configured.');
    return this.codexClient.probeReasoningEffort(model, effort);
  }

  public updateCodexReasoningProfile(
    model: string,
    efforts: import('../types.ts').CodexReasoningEffort[],
    defaultEffort?: import('../types.ts').CodexReasoningEffort
  ): void {
    if (!this.config.providers.codex.reasoning) {
      this.config.providers.codex.reasoning = { models: {}, anthropicBudget: { lowMaxTokens: 2000, mediumMaxTokens: 8000 } };
    }
    const profiles = this.config.providers.codex.reasoning.models;
    const canonicalModel = CodexRequestAdapter.mapModel(model);
    if (efforts.length === 0) delete profiles[canonicalModel];
    else profiles[canonicalModel] = { efforts: [...efforts], ...(defaultEffort ? { default: defaultEffort } : {}) };
  }

  public getGoogleReasoningProfile(model: string): GoogleReasoningProfile | undefined {
    return this.googleClient?.getReasoningProfile(model);
  }

  public updateGoogleReasoningProfile(model: string, profile?: GoogleReasoningProfile): void {
    if (!this.config.providers.google.reasoning) this.config.providers.google.reasoning = { models: {} };
    const canonical = canonicalGoogleModel(model);
    this.googleClient?.updateReasoningProfile(canonical, profile);
    if (profile) this.config.providers.google.reasoning.models[canonical] = profile;
    else delete this.config.providers.google.reasoning.models[canonical];
  }

  public async probeGoogleReasoningEffort(
    model: string, effort: GoogleReasoningEffort, thinkingConfig: GoogleThinkingConfig, maxOutputTokens: number
  ): Promise<{ status: 'accepted' | 'rejected' | 'failed'; scopes: GoogleReasoningScope[]; httpStatus?: number; error?: string }> {
    if (this.resolveProvider(model) !== 'google' || !this.googleClient) throw new Error(`Model '${model}' is not routed to Google`);
    return this.googleClient.probeReasoningEffort(model, effort, thinkingConfig, maxOutputTokens);
  }

  public getCodexAccountStatus() {
    if (!this.codexClient) return null;
    return this.codexClient.getAccountStatus();
  }

  public async getGoogleQuota(targetAccountId?: string) {
    if (!this.googleClient) throw new Error('Google Provider is not enabled or configured.');
    return this.googleClient.fetchQuota(targetAccountId);
  }

  public async refreshCodexUsage() {
    if (!this.codexClient) throw new Error('Codex Provider is not enabled or configured.');
    return this.codexClient.refreshUsage();
  }

  public async checkCodexConnection(model: string) {
    if (this.resolveProvider(model) !== 'codex') {
      throw new Error(`Model '${model}' is not routed to the Codex provider`);
    }
    if (!this.codexClient) throw new Error('Codex Provider is not enabled or configured.');
    return this.codexClient.checkConnection(model);
  }
}
