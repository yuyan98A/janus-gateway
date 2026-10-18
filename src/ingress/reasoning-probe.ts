import http from 'node:http';
import type { CodexReasoningEffort, GoogleReasoningEffort, GoogleThinkingConfig } from '../types.ts';
import type { Dispatcher } from '../router/dispatcher.ts';
import { rememberReasoningProbeResults, rememberGoogleReasoningProbeResults } from './reasoning-profile.ts';
import { GOOGLE_BUDGET_CANDIDATES, GOOGLE_EFFORTS, GOOGLE_LEVEL_CANDIDATES, canonicalGoogleModel } from '../providers/google/reasoning.ts';

const ALLOWED_EFFORTS: CodexReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_EFFORTS: CodexReasoningEffort[] = ['low', 'medium', 'high'];

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleReasoningProbe(
  res: http.ServerResponse,
  dispatcher: Dispatcher,
  body: any
): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: { message: 'Request body must be a JSON object' } });
    return;
  }
  if (typeof body.model !== 'string' || !body.model.trim()) {
    sendJson(res, 400, { error: { message: 'model must be a non-empty string' } });
    return;
  }
  if (body.efforts !== undefined && (!Array.isArray(body.efforts) || body.efforts.length === 0)) {
    sendJson(res, 400, { error: { message: 'efforts must be a non-empty array' } });
    return;
  }

  const efforts = body.efforts === undefined ? DEFAULT_EFFORTS : [...new Set(body.efforts)];
  const google = dispatcher.resolveProvider(body.model) === 'google';
  const allowed = google ? GOOGLE_EFFORTS : ALLOWED_EFFORTS;
  if (efforts.length > allowed.length || efforts.some((effort: unknown) => !allowed.includes(effort as GoogleReasoningEffort))) {
    sendJson(res, 400, {
      error: { message: `efforts may contain these values only: ${allowed.join(', ')}` }
    });
    return;
  }

  const available = await dispatcher.listAllModels();
  if (!available.some(model => model.id === body.model || (google && model.id === canonicalGoogleModel(body.model)))) {
    sendJson(res, 404, { error: { message: `Unknown model '${body.model}'` }, availableModels: available.map(model => model.id) });
    return;
  }
  if (google) {
    const mode = body.mode ?? 'budget';
    if (mode !== 'budget' && mode !== 'level') {
      sendJson(res, 400, { error: { message: 'mode must be budget or level' } });
      return;
    }
    if (body.budgets !== undefined && (!body.budgets || typeof body.budgets !== 'object' || Array.isArray(body.budgets))) {
      sendJson(res, 400, { error: { message: 'budgets must be an object keyed by effort' } });
      return;
    }
    if (body.maxOutputTokens !== undefined && (!Number.isSafeInteger(body.maxOutputTokens) || body.maxOutputTokens < 1)) {
      sendJson(res, 400, { error: { message: 'maxOutputTokens must be a positive integer' } });
      return;
    }
    const results = [];
    for (const effort of efforts as GoogleReasoningEffort[]) {
      const budget = body.budgets?.[effort] ?? GOOGLE_BUDGET_CANDIDATES[effort];
      const thinkingConfig: GoogleThinkingConfig | undefined = mode === 'level'
        ? GOOGLE_LEVEL_CANDIDATES[effort]
        : Number.isSafeInteger(budget) && budget >= 0 ? { thinkingBudget: budget } : undefined;
      if (!thinkingConfig) {
        results.push({ effort, status: 'rejected' as const, error: `No ${mode} candidate for ${effort}; supply a valid budget or select another effort` });
        continue;
      }
      const candidateBudget = 'thinkingBudget' in thinkingConfig ? thinkingConfig.thinkingBudget : 0;
      const maxOutputTokens = body.maxOutputTokens ?? Math.max(4096, candidateBudget + 1024);
      if (candidateBudget >= maxOutputTokens) {
        results.push({ effort, status: 'rejected' as const, error: 'maxOutputTokens must exceed thinkingBudget' });
        continue;
      }
      const outcome = await dispatcher.probeGoogleReasoningEffort(body.model, effort, thinkingConfig, maxOutputTokens);
      results.push({ effort, mode, thinkingConfig, maxOutputTokens, ...outcome });
    }
    rememberGoogleReasoningProbeResults(canonicalGoogleModel(body.model), results);
    sendJson(res, 200, {
      object: 'google_reasoning_probe', model: canonicalGoogleModel(body.model),
      note: 'Accepted means PA completed a generation with this exact parameter on at least one account; it does not prove a measurable reasoning difference.',
      results: results.map(({ scopes, ...result }: any) => ({ ...result, verifiedAccountCount: scopes?.length || 0 })),
      suggestedConfig: {
        model: canonicalGoogleModel(body.model), mode,
        efforts: results.filter(result => result.status === 'accepted').map(result => result.effort)
      }
    });
    return;
  }

  const results = [];
  for (const effort of efforts as CodexReasoningEffort[]) {
    results.push({
      effort,
      ...(await dispatcher.probeCodexReasoningEffort(body.model, effort))
    });
  }

  rememberReasoningProbeResults(body.model, results);

  const acceptedEfforts = results.filter(result => result.status === 'accepted').map(result => result.effort);
  sendJson(res, 200, {
    object: 'codex_reasoning_probe',
    model: body.model,
    note: 'Accepted means the upstream returned a successful HTTP response. It does not prove that the model changes reasoning behavior for each effort.',
    results,
    suggestedConfig: {
      model: body.model,
      efforts: acceptedEfforts
    }
  });
}
