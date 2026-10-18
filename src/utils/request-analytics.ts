import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

export interface RequestSummary {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  protocol?: string;
  model?: string;
  upstreamModel?: string;
  provider?: string;
  statusCode?: number;
  durationMs?: number;
  stream?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  usageSource?: 'upstream' | 'adapter' | 'unavailable';
  result: 'success' | 'error' | 'interrupted';
  error?: string;
  sourceFiles: string[];
}

export interface RequestAccumulator {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  protocol?: string;
  model?: string;
  upstreamModel?: string;
  provider?: string;
  statusCode?: number;
  durationMs?: number;
  stream?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  usageSource?: 'upstream' | 'adapter' | 'unavailable';
  error?: string;
  completed: boolean;
  interrupted: boolean;
  sourceFiles: Set<string>;
}

const logDirectory = path.join(process.cwd(), 'logs');
const indexDirectory = path.join(logDirectory, 'index');
const manifestPath = path.join(indexDirectory, 'manifest.json');
const inferencePath = /^\/(?:v1\/)?(?:messages|chat\/completions)$/;

export function createRequestAccumulator(input: {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
}): RequestAccumulator {
  const protocol = input.path.endsWith('/messages') ? 'anthropic-messages'
    : input.path.endsWith('/chat/completions') ? 'openai-chat-completions' : undefined;
  return {
    requestId: input.requestId,
    timestamp: input.timestamp,
    method: input.method,
    path: input.path,
    protocol,
    completed: false,
    interrupted: false,
    sourceFiles: new Set([sourceFilename(input.timestamp)])
  };
}

function sourceFilename(timestamp: string): string {
  return `gateway-${timestamp.slice(0, 10)}.jsonl`;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function recordUsage(
  accumulator: RequestAccumulator,
  input: unknown,
  output: unknown,
  source: 'upstream' | 'adapter'
): void {
  const inputTokens = numberValue(input);
  const outputTokens = numberValue(output);
  if (inputTokens === undefined && outputTokens === undefined) return;
  if ((inputTokens ?? 0) === 0 && (outputTokens ?? 0) === 0) return;
  if (inputTokens !== undefined) accumulator.inputTokens = inputTokens;
  if (outputTokens !== undefined) accumulator.outputTokens = outputTokens;
  if (source === 'upstream' || accumulator.usageSource !== 'upstream') accumulator.usageSource = source;
}

function messageFromError(value: unknown): string | undefined {
  if (typeof value === 'string') return value.slice(0, 2000);
  if (!value || typeof value !== 'object') return undefined;
  const object = value as Record<string, unknown>;
  const nested = object.error && typeof object.error === 'object'
    ? object.error as Record<string, unknown>
    : undefined;
  const message = object.message ?? nested?.message ?? object.detail;
  return typeof message === 'string' ? message.slice(0, 2000) : undefined;
}

function applyUpstreamPayload(accumulator: RequestAccumulator, payload: any): void {
  if (!payload || typeof payload !== 'object') return;
  const type = payload.type || payload.event;
  if (type === 'response.completed') {
    const usage = payload.response?.usage || payload.usage;
    if (usage) recordUsage(accumulator, usage.input_tokens, usage.output_tokens, 'upstream');
    const model = payload.response?.model;
    if (typeof model === 'string') accumulator.upstreamModel = model;
  } else if (type === 'response.failed' || type === 'error') {
    accumulator.error = messageFromError(payload.response?.error || payload.error || payload);
  }

  const googleUsage = payload.response?.usageMetadata || payload.usageMetadata;
  if (googleUsage) {
    recordUsage(
      accumulator,
      googleUsage.promptTokenCount,
      googleUsage.candidatesTokenCount,
      'upstream'
    );
  }
  const googleError = payload.response?.promptFeedback?.blockReason || payload.error;
  if (googleError) accumulator.error ||= messageFromError(googleError) || String(googleError);
}

function parseSseBody(accumulator: RequestAccumulator, rawBody: unknown): void {
  if (typeof rawBody !== 'string' || rawBody.length === 0) return;
  for (const line of rawBody.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      applyUpstreamPayload(accumulator, JSON.parse(data));
    } catch {
      // Ignore non-JSON SSE comments and partial diagnostics.
    }
  }
}

export function applyRequestLogEvent(
  accumulator: RequestAccumulator,
  event: string,
  record: Record<string, any>
): void {
  const eventTimestamp = typeof record.timestamp === 'string' ? record.timestamp : accumulator.timestamp;
  accumulator.sourceFiles.add(sourceFilename(eventTimestamp));

  if (event === 'http.request') {
    if (typeof record.method === 'string') accumulator.method = record.method;
    if (typeof record.path === 'string') accumulator.path = record.path;
  }
  if (event === 'http.request_body') {
    const body = record.parsedBody;
    if (body && typeof body === 'object') {
      if (typeof body.model === 'string') accumulator.model = body.model;
      if (typeof body.stream === 'boolean') accumulator.stream = body.stream;
    }
  }
  if (event === 'routing.selected' || event === 'ingress.stream_started' || event === 'ingress.stream_completed') {
    if (typeof record.protocol === 'string') accumulator.protocol = record.protocol;
    if (typeof record.model === 'string') accumulator.model = record.model;
    if (typeof record.provider === 'string') accumulator.provider = record.provider;
    if (event === 'ingress.stream_started') accumulator.stream = true;
  }
  if (event === 'upstream.request') {
    if (typeof record.provider === 'string') accumulator.provider = record.provider;
    if (typeof record.body === 'string') {
      try {
        const body = JSON.parse(record.body);
        if (typeof body.model === 'string') accumulator.upstreamModel = body.model;
      } catch {
        // The body may use a provider-specific non-JSON format.
      }
    }
  }
  if (event === 'upstream.response_headers') {
    if (typeof record.provider === 'string') accumulator.provider = record.provider;
    if (typeof record.status === 'number' && record.status >= 400) {
      accumulator.statusCode = record.status;
    }
  }
  if (event === 'ingress.response_event') {
    const payload = record.payload;
    const usageSource = accumulator.provider === 'google' ? 'upstream' : 'adapter';
    if (payload?.type === 'message_start') {
      const usage = payload.message?.usage;
      if (usage) recordUsage(accumulator, usage.input_tokens, usage.output_tokens, usageSource);
      if (typeof payload.message?.model === 'string') accumulator.upstreamModel ||= payload.message.model;
    } else if (payload?.type === 'message_delta' && payload.usage) {
      recordUsage(accumulator, payload.usage.input_tokens, payload.usage.output_tokens, usageSource);
    } else if (payload?.usage) {
      recordUsage(accumulator, payload.usage.prompt_tokens, payload.usage.completion_tokens, usageSource);
    }
    applyUpstreamPayload(accumulator, payload);
  }
  if (event === 'ingress.response_body') {
    const body = record.body;
    const usage = body?.usage;
    if (usage) {
      recordUsage(
        accumulator,
        usage.input_tokens ?? usage.prompt_tokens,
        usage.output_tokens ?? usage.completion_tokens,
        accumulator.provider === 'google' ? 'upstream' : 'adapter'
      );
    }
    if (typeof body?.model === 'string') accumulator.upstreamModel ||= body.model;
  }
  if (event === 'stream.complete') parseSseBody(accumulator, record.rawBody);
  if (event === 'upstream.error_body') {
    accumulator.error ||= messageFromError(record.rawBody || record.error) || '上游请求失败';
    if (typeof record.status === 'number') accumulator.statusCode = record.status;
  }
  if (event === 'ingress.error' || event === 'http.unhandled_error' || event === 'upstream.network_error') {
    accumulator.error ||= messageFromError(record.error) || '请求处理失败';
  }
  if (event === 'http.response') {
    if (typeof record.statusCode === 'number') accumulator.statusCode = record.statusCode;
    if (typeof record.durationMs === 'number') accumulator.durationMs = record.durationMs;
    accumulator.completed = true;
  }
  if (event === 'http.client_disconnected') {
    if (typeof record.statusCode === 'number') accumulator.statusCode = record.statusCode;
    if (typeof record.durationMs === 'number') accumulator.durationMs = record.durationMs;
    accumulator.completed = true;
    accumulator.interrupted = true;
    accumulator.error ||= '客户端提前断开连接';
  }
}

export function finalizeRequestSummary(accumulator: RequestAccumulator): RequestSummary | null {
  if (!inferencePath.test(accumulator.path) || !accumulator.completed) return null;
  const status = accumulator.statusCode || 0;
  const result: RequestSummary['result'] = accumulator.interrupted
    ? 'interrupted'
    : accumulator.error || status >= 400 ? 'error'
      : status >= 200 && status < 300 ? 'success' : 'interrupted';
  return {
    requestId: accumulator.requestId,
    timestamp: accumulator.timestamp,
    method: accumulator.method,
    path: accumulator.path,
    protocol: accumulator.protocol,
    model: accumulator.model,
    upstreamModel: accumulator.upstreamModel,
    provider: accumulator.provider,
    statusCode: accumulator.statusCode,
    durationMs: accumulator.durationMs,
    stream: accumulator.stream,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    usageSource: accumulator.usageSource || 'unavailable',
    result,
    error: accumulator.error,
    sourceFiles: [...accumulator.sourceFiles]
  };
}

function summaryFilename(timestamp: string): string {
  return path.join(indexDirectory, `requests-${timestamp.slice(0, 10)}.jsonl`);
}

function safeDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function* readJsonLines(filePath: string, end?: number): AsyncGenerator<Record<string, any>> {
  const stream = createReadStream(filePath, end === undefined ? {} : { start: 0, end });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Preserve service availability if an earlier process was interrupted mid-write.
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

export class RequestAnalyticsStore {
  private ready: Promise<void> | null = null;
  private knownIds = new Set<string>();
  private status = { running: false, processedFiles: 0, totalFiles: 0, indexedRequests: 0, currentFile: '', error: '' };
  private appendQueue: Promise<void> = Promise.resolve();

  initialize(): Promise<void> {
    if (!this.ready) {
      this.ready = this.initializeOnce().catch(error => {
        this.status.running = false;
        this.status.error = error instanceof Error ? error.message : String(error);
        throw error;
      });
    }
    return this.ready;
  }

  getStatus() {
    return { ...this.status, complete: this.ready !== null && !this.status.running };
  }

  async record(summary: RequestSummary | null): Promise<void> {
    if (!summary) return;
    await this.initialize();
    if (this.knownIds.has(summary.requestId)) return;
    await this.appendSummary(summary);
    this.knownIds.add(summary.requestId);
  }

  async list(options: {
    from?: string | null;
    to?: string | null;
    requestId?: string;
    model?: string;
    provider?: string;
    result?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ data: RequestSummary[]; total: number; indexing: ReturnType<RequestAnalyticsStore['getStatus']> }> {
    await this.initialize();
    const all = await this.readSummaries(options.from, options.to);
    const filtered = all.filter(item =>
      (!options.requestId || item.requestId.toLowerCase().includes(options.requestId.toLowerCase())) &&
      (!options.model || (item.model || '').toLowerCase().includes(options.model.toLowerCase())) &&
      (!options.provider || item.provider === options.provider) &&
      (!options.result || item.result === options.result)
    ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit || 50)));
    const offset = Math.max(0, Math.floor(options.offset || 0));
    return { data: filtered.slice(offset, offset + limit), total: filtered.length, indexing: this.getStatus() };
  }

  async summary(from?: string | null, to?: string | null) {
    await this.initialize();
    const records = await this.readSummaries(from, to);
    const byProvider = new Map<string, any>();
    const byModel = new Map<string, any>();
    const byDay = new Map<string, any>();
    let exactInputTokens = 0;
    let exactOutputTokens = 0;
    let reportedRequests = 0;
    const totals = { requests: records.length, success: 0, error: 0, interrupted: 0 };
    for (const record of records) {
      totals[record.result]++;
      const day = record.timestamp.slice(0, 10);
      const provider = record.provider || 'unknown';
      const model = record.model || 'unknown';
      const add = (map: Map<string, any>, key: string) => {
        const item = map.get(key) || { name: key, requests: 0, success: 0, error: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
        item.requests++;
        if (record.result === 'success') item.success++;
        if (record.result !== 'success') item.error++;
        map.set(key, item);
        return item;
      };
      const providerRow = add(byProvider, provider);
      const modelRow = add(byModel, model);
      const dayRow = byDay.get(day) || { date: day, requests: 0, success: 0, error: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
      dayRow.requests++;
      if (record.result === 'success') dayRow.success++;
      else dayRow.error++;
      if (record.usageSource === 'upstream' && (record.inputTokens !== undefined || record.outputTokens !== undefined)) {
        const input = record.inputTokens || 0;
        const output = record.outputTokens || 0;
        exactInputTokens += input;
        exactOutputTokens += output;
        reportedRequests++;
        providerRow.inputTokens += input;
        providerRow.outputTokens += output;
        providerRow.reportedRequests++;
        modelRow.inputTokens += input;
        modelRow.outputTokens += output;
        modelRow.reportedRequests++;
        dayRow.inputTokens += input;
        dayRow.outputTokens += output;
        dayRow.reportedRequests++;
      }
      byDay.set(day, dayRow);
    }
    return {
      totals: { ...totals, successRate: totals.requests ? totals.success / totals.requests : 0, inputTokens: exactInputTokens, outputTokens: exactOutputTokens, reportedRequests },
      byProvider: [...byProvider.values()].sort((a, b) => b.requests - a.requests),
      byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
      byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      indexing: this.getStatus()
    };
  }

  async details(requestId: string): Promise<{ summary: RequestSummary | null; events: Record<string, any>[] }> {
    await this.initialize();
    const summaries = await this.readSummaries();
    const summary = summaries.find(item => item.requestId === requestId) || null;
    if (!summary) return { summary: null, events: [] };
    const files = summary.sourceFiles.map(name => path.join(logDirectory, name));
    const events: Record<string, any>[] = [];
    for (const file of files) {
      try {
        for await (const record of readJsonLines(file)) {
          if (record.requestId === requestId) events.push(record);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return { summary, events };
  }

  private async readSummaries(from?: string | null, to?: string | null): Promise<RequestSummary[]> {
    const fromDate = safeDate(from || null);
    const toDate = safeDate(to || null);
    const names = (await readdir(indexDirectory).catch(() => []))
      .filter(name => /^requests-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .filter(name => {
        const date = name.slice('requests-'.length, -'.jsonl'.length);
        return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
      });
    const records: RequestSummary[] = [];
    for (const name of names) {
      for await (const record of readJsonLines(path.join(indexDirectory, name))) {
        if (typeof record.requestId === 'string' && typeof record.timestamp === 'string') records.push(record as RequestSummary);
      }
    }
    return records;
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(indexDirectory, { recursive: true });
    const summaryNames = (await readdir(indexDirectory)).filter(name => /^requests-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name));
    for (const name of summaryNames) {
      for await (const record of readJsonLines(path.join(indexDirectory, name))) {
        if (typeof record.requestId === 'string') this.knownIds.add(record.requestId);
      }
    }

    const manifest = await readFile(manifestPath, 'utf8').then(text => JSON.parse(text)).catch(() => ({} as Record<string, any>));
    const rawNames = (await readdir(logDirectory)).filter(name => /^gateway-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
    this.status.running = true;
    this.status.totalFiles = rawNames.length;
    void this.backfillFiles(rawNames, manifest).catch(error => {
      this.status.error = error instanceof Error ? error.message : String(error);
      console.error('[RequestAnalytics] Backfill failed:', this.status.error);
    }).finally(() => {
      this.status.currentFile = '';
      this.status.running = false;
    });
  }

  private async backfillFiles(rawNames: string[], manifest: Record<string, any>): Promise<void> {
    const builders = new Map<string, RequestAccumulator>();

    for (const name of rawNames) {
      this.status.currentFile = name;
      const filePath = path.join(logDirectory, name);
      const fileStat = await stat(filePath);
      const snapshot = { size: fileStat.size, mtimeMs: fileStat.mtimeMs };
      const previous = manifest[name];
      if (!previous || previous.size !== snapshot.size || previous.mtimeMs !== snapshot.mtimeMs) {
        if (snapshot.size > 0) for await (const record of readJsonLines(filePath, snapshot.size - 1)) {
          if (typeof record.requestId !== 'string') continue;
          const event = typeof record.event === 'string' ? record.event : '';
          let accumulator = builders.get(record.requestId);
          if (!accumulator) {
            accumulator = createRequestAccumulator({
              requestId: record.requestId,
              timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString(),
              method: typeof record.method === 'string' ? record.method : 'UNKNOWN',
              path: typeof record.path === 'string' ? record.path : ''
            });
            builders.set(record.requestId, accumulator);
          }
          applyRequestLogEvent(accumulator, event, record);
        }
        manifest[name] = snapshot;
      }
      this.status.processedFiles++;
    }

    for (const accumulator of builders.values()) {
      const summary = finalizeRequestSummary(accumulator);
      if (!summary || this.knownIds.has(summary.requestId)) continue;
      await this.appendSummary(summary);
      this.knownIds.add(summary.requestId);
      this.status.indexedRequests++;
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  private async appendSummary(summary: RequestSummary): Promise<void> {
    const line = `${JSON.stringify(summary)}\n`;
    this.appendQueue = this.appendQueue.catch(() => {}).then(async () => {
      await appendFile(summaryFilename(summary.timestamp), line, 'utf8');
    });
    await this.appendQueue;
  }
}

export const requestAnalytics = new RequestAnalyticsStore();
