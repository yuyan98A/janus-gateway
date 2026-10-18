import http from 'node:http';
import type { Dispatcher } from '../router/dispatcher.ts';
import type { OpenAIChatRequest } from '../types.ts';

const DEFAULT_PROMPT = 'Reply with exactly: OK';
const DEFAULT_MAX_TOKENS = 32;
const MAX_MODELS_PER_REQUEST = 100;
const MAX_PROMPT_LENGTH = 500;

interface ModelTestBody {
  all?: unknown;
  model?: unknown;
  models?: unknown;
  prompt?: unknown;
  maxTokens?: unknown;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getSafeError(error: unknown): { message: string; code?: number } {
  const raw = error instanceof Error ? error.message : String(error);
  const codeMatch = raw.match(/\b(?:HTTP\s*)?\(?([45]\d\d)\)?\b/i);
  const code = codeMatch ? Number(codeMatch[1]) : undefined;
  let message = raw;

  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const payload = parsed?.error ?? parsed;
      if (typeof payload?.message === 'string') message = payload.message;
      else if (typeof payload?.detail === 'string') message = payload.detail;
    } catch {
      // Keep the original message and sanitize it below.
    }
  }

  message = message
    .replace(/https?:\/\/\S+/gi, '[upstream URL]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

  if (message.length > 300) message = `${message.slice(0, 297)}...`;
  return { message: message || 'Model request failed', ...(code ? { code } : {}) };
}

function parseModelSelection(body: ModelTestBody): { all: boolean; models: string[] } | string {
  const hasSingle = body.model !== undefined;
  const hasMultiple = body.models !== undefined;
  const hasAll = body.all !== undefined;

  if (hasSingle && hasMultiple) return 'Use either model or models, not both';
  if (hasAll && typeof body.all !== 'boolean') return 'all must be a boolean';
  if (body.all === true && (hasSingle || hasMultiple)) return 'Use all or a model selection, not both';
  if (body.all === false && !hasSingle && !hasMultiple) return 'Select a model or set all to true';

  if (hasSingle) {
    if (typeof body.model !== 'string' || !body.model.trim()) return 'model must be a non-empty string';
    return { all: false, models: [body.model.trim()] };
  }

  if (hasMultiple) {
    if (!Array.isArray(body.models) || body.models.length === 0) return 'models must be a non-empty array';
    if (!body.models.every(model => typeof model === 'string' && model.trim())) {
      return 'models must contain non-empty strings';
    }
    const models = [...new Set((body.models as string[]).map(model => model.trim()))];
    if (models.length > MAX_MODELS_PER_REQUEST) return `At most ${MAX_MODELS_PER_REQUEST} models can be tested per request`;
    return { all: false, models };
  }

  return { all: true, models: [] };
}

export async function handleModelTest(
  res: http.ServerResponse,
  dispatcher: Dispatcher,
  body: ModelTestBody
): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: { message: 'Request body must be a JSON object' } });
    return;
  }

  const selection = parseModelSelection(body);
  if (typeof selection === 'string') {
    sendJson(res, 400, { error: { message: selection } });
    return;
  }

  const prompt = body?.prompt === undefined ? DEFAULT_PROMPT : body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
    sendJson(res, 400, { error: { message: `prompt must be a non-empty string of at most ${MAX_PROMPT_LENGTH} characters` } });
    return;
  }

  const maxTokens = body?.maxTokens === undefined ? DEFAULT_MAX_TOKENS : body.maxTokens;
  if (!Number.isInteger(maxTokens) || Number(maxTokens) < 16 || Number(maxTokens) > 128) {
    sendJson(res, 400, { error: { message: 'maxTokens must be an integer between 16 and 128' } });
    return;
  }

  const availableModels = await dispatcher.listAllModels();
  const availableIds = new Set(availableModels.map(model => model.id));
  const models = selection.all ? availableModels.map(model => model.id) : selection.models;

  if (models.length === 0) {
    sendJson(res, 503, { error: { message: 'No models are currently available to test' } });
    return;
  }
  if (models.length > MAX_MODELS_PER_REQUEST) {
    sendJson(res, 400, { error: { message: `At most ${MAX_MODELS_PER_REQUEST} models can be tested per request` } });
    return;
  }

  const unknown = models.filter(model => !availableIds.has(model));
  if (unknown.length > 0) {
    sendJson(res, 404, {
      error: { message: `Unknown model${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}` },
      availableModels: [...availableIds]
    });
    return;
  }

  const results = [];
  for (const model of models) {
    const startedAt = Date.now();
    const modelInfo = availableModels.find(item => item.id === model);
    const thinkingBudget = dispatcher.resolveProvider(model) === 'google'
      ? modelInfo?.min_thinking_budget
      : undefined;
    const effectiveMaxTokens = Math.max(Number(maxTokens), thinkingBudget ? thinkingBudget + 256 : Number(maxTokens));
    const request: OpenAIChatRequest = {
      model,
      messages: [{ role: 'user', content: prompt.trim() }],
      max_tokens: effectiveMaxTokens,
      stream: true
    };

    try {
      let responseText = '';
      for await (const chunk of dispatcher.dispatchOpenAI(request, { googleThinkingBudget: thinkingBudget })) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (typeof content === 'string') responseText += content;
      }

      if (!responseText.trim()) throw new Error('Model returned no text');
      results.push({
        model,
        provider: dispatcher.resolveProvider(model),
        status: 'passed' as const,
        elapsedMs: Date.now() - startedAt,
        maxTokens: effectiveMaxTokens,
        sample: responseText.trim().slice(0, 160)
      });
    } catch (error) {
      const safeError = getSafeError(error);
      results.push({
        model,
        provider: dispatcher.resolveProvider(model),
        status: 'failed' as const,
        elapsedMs: Date.now() - startedAt,
        maxTokens: effectiveMaxTokens,
        error: safeError.message,
        ...(safeError.code ? { errorCode: safeError.code } : {})
      });
    }
  }

  const passed = results.filter(result => result.status === 'passed').length;
  sendJson(res, 200, {
    object: 'model_test_result',
    total: results.length,
    passed,
    failed: results.length - passed,
    results
  });
}
