import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { CodexReasoningEffort, GatewayConfig, GoogleReasoningEffort, GoogleReasoningProfile, GoogleThinkingConfig, GoogleReasoningScope } from '../types.ts';
import type { Dispatcher } from '../router/dispatcher.ts';
import { CodexRequestAdapter } from '../providers/codex/request-adapter.ts';
import { GOOGLE_EFFORTS, canonicalGoogleModel, validateGoogleReasoningProfile } from '../providers/google/reasoning.ts';

const ALLOWED_EFFORTS: CodexReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PROBE_TTL_MS = 30 * 60 * 1000;
const recentProbeResults = new Map<string, Map<CodexReasoningEffort, { accepted: boolean; checkedAt: number }>>();
const recentGoogleProbeResults = new Map<string, Map<GoogleReasoningEffort, {
  status: 'accepted' | 'rejected' | 'failed';
  checkedAt: number;
  mode: 'budget' | 'level';
  thinkingConfig: GoogleThinkingConfig;
  maxOutputTokens: number;
  scopes: GoogleReasoningScope[];
}>>();

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function rememberReasoningProbeResults(
  model: string,
  results: Array<{ effort: CodexReasoningEffort; status: 'accepted' | 'rejected' | 'failed' }>
): void {
  const canonicalModel = CodexRequestAdapter.mapModel(model);
  const modelResults = recentProbeResults.get(canonicalModel) ?? new Map();
  const checkedAt = Date.now();
  for (const result of results) {
    modelResults.set(result.effort, { accepted: result.status === 'accepted', checkedAt });
  }
  recentProbeResults.set(canonicalModel, modelResults);
}

export function rememberGoogleReasoningProbeResults(
  model: string,
  results: Array<{
    effort: GoogleReasoningEffort;
    status: 'accepted' | 'rejected' | 'failed';
    mode?: 'budget' | 'level';
    thinkingConfig?: GoogleThinkingConfig;
    maxOutputTokens?: number;
    scopes?: GoogleReasoningScope[];
  }>
): void {
  const canonical = canonicalGoogleModel(model);
  const probes = recentGoogleProbeResults.get(canonical) ?? new Map();
  for (const result of results) {
    if (result.mode && result.thinkingConfig && result.maxOutputTokens) {
      probes.set(result.effort, {
        status: result.status, checkedAt: Date.now(), mode: result.mode,
        thinkingConfig: result.thinkingConfig, maxOutputTokens: result.maxOutputTokens,
        scopes: result.scopes ?? []
      });
    }
  }
  recentGoogleProbeResults.set(canonical, probes);
}

function saveGoogleReasoningProfile(
  res: http.ServerResponse,
  body: any,
  config: GatewayConfig,
  dispatcher: Dispatcher,
  configFile: string
): void {
  const model = canonicalGoogleModel(body.model.trim());
  const efforts = [...new Set(body.efforts)] as GoogleReasoningEffort[];
  if (efforts.length > GOOGLE_EFFORTS.length || efforts.some(effort => !GOOGLE_EFFORTS.includes(effort))) {
    sendJson(res, 400, { error: { message: `efforts may contain these values only: ${GOOGLE_EFFORTS.join(', ')}` } });
    return;
  }
  const existing = dispatcher.getGoogleReasoningProfile(model);
  const recent = recentGoogleProbeResults.get(model);
  const modes = new Set(efforts.map(effort => {
    const probe = recent?.get(effort);
    return probe?.status === 'accepted' && probe.scopes.length > 0
      ? probe.mode
      : existing?.effortMap[effort] ? existing.effortMode : undefined;
  }));
  if (modes.has(undefined) || modes.size > 1 || efforts.some(effort => {
    const probe = recent?.get(effort);
    return !existing?.effortMap[effort] && (!probe || probe.status !== 'accepted' || probe.scopes.length === 0 || Date.now() - probe.checkedAt > PROBE_TTL_MS);
  })) {
    sendJson(res, 409, { error: { message: 'Every new Google effort needs a recent accepted PA probe in the same control mode' } });
    return;
  }
  const mode = [...modes][0] as 'budget' | 'level' | undefined;
  const effortMap: GoogleReasoningProfile['effortMap'] = {};
  const evidence: GoogleReasoningProfile['evidence'] = {};
  let defaultMaxOutputTokens = 0;
  for (const effort of efforts) {
    const probe = recent?.get(effort);
    const useProbe = probe?.status === 'accepted' && probe.mode === mode && probe.scopes.length > 0 && Date.now() - probe.checkedAt <= PROBE_TTL_MS;
    effortMap[effort] = useProbe ? probe!.thinkingConfig : existing!.effortMap[effort];
    evidence[effort] = useProbe ? probe!.scopes : existing!.evidence[effort];
    defaultMaxOutputTokens = Math.max(defaultMaxOutputTokens, useProbe ? probe!.maxOutputTokens : existing?.defaultMaxOutputTokens || 0);
  }
  const positiveBudgets = Object.values(effortMap)
    .filter((value): value is { thinkingBudget: number } => Boolean(value && 'thinkingBudget' in value))
    .map(value => value.thinkingBudget).filter(value => value > 0);
  const profile: GoogleReasoningProfile | undefined = efforts.length ? {
    effortMode: mode!, effortMap, evidence,
    ...(mode === 'budget' ? { budget: {
      min: positiveBudgets.length ? Math.min(...positiveBudgets) : 0,
      max: positiveBudgets.length ? Math.max(...positiveBudgets) : 0,
      canDisable: Boolean(effortMap.none),
      canDynamic: false,
      requiresBudgetBelowOutputLimit: true
    } } : {}),
    defaultMaxOutputTokens: defaultMaxOutputTokens || 4096
  } : undefined;
  try {
    if (profile) validateGoogleReasoningProfile(model, profile);
  } catch (error) {
    sendJson(res, 409, { error: { message: error instanceof Error ? error.message : String(error) } });
    return;
  }
  const absolutePath = path.resolve(configFile);
  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    parsed.providers ??= {};
    parsed.providers.google ??= {};
    parsed.providers.google.reasoning ??= {};
    parsed.providers.google.reasoning.models ??= {};
    if (profile) parsed.providers.google.reasoning.models[model] = profile;
    else delete parsed.providers.google.reasoning.models[model];
    const modeBits = fs.statSync(absolutePath).mode;
    const temporary = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: modeBits & 0o777 });
      fs.renameSync(temporary, absolutePath);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* already removed */ }
      throw error;
    }
    dispatcher.updateGoogleReasoningProfile(model, profile);
    sendJson(res, 200, { object: 'google_reasoning_profile', model, efforts, saved: true, configFile: path.basename(absolutePath) });
  } catch (error) {
    sendJson(res, 500, { error: { message: `Could not save Google reasoning profile: ${error instanceof Error ? error.message : String(error)}` } });
  }
}

export async function handleReasoningProfileSave(
  res: http.ServerResponse,
  body: any,
  config: GatewayConfig,
  dispatcher: Dispatcher,
  configFile = 'config.json'
): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: { message: 'Request body must be a JSON object' } });
    return;
  }
  if (typeof body.model !== 'string' || !body.model.trim()) {
    sendJson(res, 400, { error: { message: 'model must be a non-empty string' } });
    return;
  }
  if (!Array.isArray(body.efforts)) {
    sendJson(res, 400, { error: { message: 'efforts must be an array; use an empty array to clear the profile' } });
    return;
  }

  if (dispatcher.resolveProvider(body.model.trim()) === 'google') {
    const availableModels = await dispatcher.listAllModels();
    if (!availableModels.some(available => available.id === body.model.trim() || available.id === canonicalGoogleModel(body.model.trim()))) {
      sendJson(res, 404, { error: { message: `Unknown model '${body.model}'` } });
      return;
    }
    saveGoogleReasoningProfile(res, body, config, dispatcher, configFile);
    return;
  }

  const model = body.model.trim();
  if (dispatcher.resolveProvider(model) !== 'codex') {
    sendJson(res, 400, { error: { message: `Model '${model}' is not routed to the Codex provider` } });
    return;
  }
  const availableModels = await dispatcher.listAllModels();
  if (!availableModels.some(available => available.id === model)) {
    sendJson(res, 404, { error: { message: `Unknown model '${model}'` } });
    return;
  }

  const efforts = [...new Set(body.efforts)] as unknown[];
  if (efforts.length > ALLOWED_EFFORTS.length || efforts.some(effort => !ALLOWED_EFFORTS.includes(effort as CodexReasoningEffort))) {
    sendJson(res, 400, { error: { message: `efforts may contain these values only: ${ALLOWED_EFFORTS.join(', ')}` } });
    return;
  }

  const canonicalModel = CodexRequestAdapter.mapModel(model);
  const existingEfforts = config.providers.codex.reasoning?.models[canonicalModel]?.efforts ?? [];
  const probed = recentProbeResults.get(canonicalModel);
  const unverifiedEfforts = efforts.filter(effort => {
    if (existingEfforts.includes(effort as CodexReasoningEffort)) return false;
    const result = probed?.get(effort as CodexReasoningEffort);
    return !result || !result.accepted || Date.now() - result.checkedAt > PROBE_TTL_MS;
  });
  if (unverifiedEfforts.length > 0) {
    sendJson(res, 409, {
      error: {
        message: `Probe these efforts successfully before saving: ${unverifiedEfforts.join(', ')}`
      }
    });
    return;
  }

  const absolutePath = path.resolve(configFile);
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    if (!parsed.providers) parsed.providers = {};
    if (!parsed.providers.codex) parsed.providers.codex = {};
    if (!parsed.providers.codex.reasoning) parsed.providers.codex.reasoning = {};
    if (!parsed.providers.codex.reasoning.models) parsed.providers.codex.reasoning.models = {};

    const modelProfiles = parsed.providers.codex.reasoning.models;
    const previous = modelProfiles[canonicalModel];
    let savedDefault: CodexReasoningEffort | undefined;
    if (efforts.length === 0) {
      delete modelProfiles[canonicalModel];
    } else {
      const profile: { efforts: CodexReasoningEffort[]; default?: CodexReasoningEffort } = {
        efforts: efforts as CodexReasoningEffort[]
      };
      if (previous?.default && efforts.includes(previous.default)) {
        profile.default = previous.default;
        savedDefault = previous.default;
      }
      modelProfiles[canonicalModel] = profile;
    }

    const originalMode = fs.statSync(absolutePath).mode;
    const tempPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: originalMode & 0o777 });
      fs.renameSync(tempPath, absolutePath);
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch { /* no temp file to clean up */ }
      throw error;
    }

    dispatcher.updateCodexReasoningProfile(canonicalModel, efforts as CodexReasoningEffort[], savedDefault);
    sendJson(res, 200, {
      object: 'codex_reasoning_profile',
      model: canonicalModel,
      efforts,
      saved: true,
      configFile: path.basename(absolutePath)
    });
  } catch (error) {
    sendJson(res, 500, {
      error: { message: `Could not save Codex reasoning profile: ${error instanceof Error ? error.message : String(error)}` }
    });
  }
}
