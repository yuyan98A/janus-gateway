import type {
  AnthropicRequest,
  GooglePreparedReasoning,
  GoogleReasoningConfig,
  GoogleReasoningEffort,
  GoogleReasoningProfile,
  GoogleThinkingConfig,
  ModelListItem,
  OpenAIChatRequest
} from '../../types.ts';

export const GOOGLE_EFFORTS: GoogleReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const GOOGLE_BUDGET_CANDIDATES: Partial<Record<GoogleReasoningEffort, number>> = {
  none: 0, minimal: 512, low: 2048, medium: 8192, high: 16384, xhigh: 24576
};
export const GOOGLE_LEVEL_CANDIDATES: Partial<Record<GoogleReasoningEffort, GoogleThinkingConfig>> = {
  minimal: { thinkingLevel: 'MINIMAL' },
  low: { thinkingLevel: 'LOW' },
  medium: { thinkingLevel: 'MEDIUM' },
  high: { thinkingLevel: 'HIGH' }
};

const GOOGLE_MODEL_ALIASES: Record<string, string> = {
  'claude-3-7-sonnet': 'claude-sonnet-4-6',
  'claude-3-5-sonnet': 'claude-sonnet-4-6',
  'claude-3-opus': 'claude-opus-4-6-thinking'
};

export function canonicalGoogleModel(model: string): string {
  return GOOGLE_MODEL_ALIASES[model] || model;
}

export class InvalidGoogleReasoningError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGoogleReasoningError';
  }
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new InvalidGoogleReasoningError(`${field} must be a positive integer`);
  }
  return Number(value);
}

function isThinkingConfig(value: unknown, mode?: 'budget' | 'level'): value is GoogleThinkingConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if ('thinkingBudget' in raw) {
    return mode !== 'level' && Object.keys(raw).length === 1 && Number.isSafeInteger(raw.thinkingBudget) && Number(raw.thinkingBudget) >= -1;
  }
  return mode !== 'budget' && Object.keys(raw).length === 1 && ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(String(raw.thinkingLevel));
}

export function validateGoogleReasoningProfile(model: string, profile: GoogleReasoningProfile): void {
  if (!profile || !['budget', 'level'].includes(profile.effortMode) || !profile.effortMap || !profile.evidence) {
    throw new Error(`Invalid Google reasoning profile for '${model}'`);
  }
  if (Object.keys(profile.effortMap).some(effort => !GOOGLE_EFFORTS.includes(effort as GoogleReasoningEffort))) {
    throw new Error(`Google reasoning profile for '${model}' contains an unknown effort`);
  }
  const budget = profile.budget;
  if (budget && (!Number.isSafeInteger(budget.min) || !Number.isSafeInteger(budget.max) || budget.min < 0 || budget.max < budget.min)) {
    throw new Error(`Invalid Google reasoning budget range for '${model}'`);
  }
  if (profile.defaultMaxOutputTokens !== undefined && (!Number.isSafeInteger(profile.defaultMaxOutputTokens) || profile.defaultMaxOutputTokens < 1)) {
    throw new Error(`Invalid Google reasoning default output limit for '${model}'`);
  }
  let previousBudget = -1;
  for (const effort of GOOGLE_EFFORTS) {
    const mapping = profile.effortMap[effort];
    if (!mapping) continue;
    if (!isThinkingConfig(mapping, profile.effortMode)) throw new Error(`Invalid Google ${effort} mapping for '${model}'`);
    if ('thinkingBudget' in mapping) {
      if (mapping.thinkingBudget < 0 || (!budget && effort !== 'none')) throw new Error(`Invalid Google ${effort} budget for '${model}'`);
      if (effort !== 'none') {
        if (mapping.thinkingBudget <= previousBudget || (budget && (mapping.thinkingBudget < budget.min || mapping.thinkingBudget > budget.max))) {
          throw new Error(`Google reasoning budgets must increase within the configured range for '${model}'`);
        }
        previousBudget = mapping.thinkingBudget;
      }
      if (effort === 'none' && (!budget?.canDisable || mapping.thinkingBudget !== 0)) {
        throw new Error(`Google model '${model}' has no verified thinking-off capability`);
      }
    }
    const scopes = profile.evidence[effort];
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(scope => !scope.accountId || !scope.projectId || !scope.endpoint || !scope.checkedAt)) {
      throw new Error(`Google reasoning effort '${effort}' for '${model}' lacks PA evidence`);
    }
  }
  if (profile.adaptive !== undefined && profile.adaptive !== 'upstream-default' && !isThinkingConfig(profile.adaptive)) {
    throw new Error(`Invalid Google adaptive thinking config for '${model}'`);
  }
}

export function getGoogleReasoningProfile(model: string, config: GoogleReasoningConfig): GoogleReasoningProfile | undefined {
  const canonical = canonicalGoogleModel(model);
  const profile = config.models[canonical];
  if (profile) validateGoogleReasoningProfile(canonical, profile);
  return profile;
}

export function googleReasoningMetadata(model: string, config: GoogleReasoningConfig): Partial<ModelListItem> {
  const profile = getGoogleReasoningProfile(model, config);
  if (!profile) return {};
  return {
    reasoning_efforts: GOOGLE_EFFORTS.filter(effort => Boolean(profile.effortMap[effort])),
    reasoning_control: profile.effortMode,
    reasoning_verification: 'pa-request-accepted',
    supports_thinking_budget: Boolean(profile.budget),
    supports_thinking_disable: Boolean(profile.budget?.canDisable)
  };
}

function resolve(
  model: string,
  source: string,
  control: { kind: 'default' | 'effort' | 'budget' | 'disabled' | 'adaptive'; effort?: GoogleReasoningEffort; tokens?: number },
  explicitMaxOutputTokens: number | undefined,
  config: GoogleReasoningConfig
): GooglePreparedReasoning {
  const canonical = canonicalGoogleModel(model);
  const profile = getGoogleReasoningProfile(canonical, config);
  let thinkingConfig: GoogleThinkingConfig | undefined;
  let allowedScopes;
  if (control.kind === 'effort' || control.kind === 'disabled') {
    const effort = control.kind === 'disabled' ? 'none' : control.effort!;
    if (!GOOGLE_EFFORTS.includes(effort)) throw new InvalidGoogleReasoningError(`Unsupported Google reasoning effort '${effort}'`);
    const mapping = profile?.effortMap[effort];
    if (!mapping) {
      const allowed = profile ? GOOGLE_EFFORTS.filter(item => profile.effortMap[item]).join(', ') : 'none configured';
      throw new InvalidGoogleReasoningError(`Google model '${canonical}' does not support configured effort '${effort}'. Available: ${allowed}`);
    }
    thinkingConfig = mapping;
    allowedScopes = profile!.evidence[effort];
  } else if (control.kind === 'budget') {
    const tokens = control.tokens!;
    if (source !== 'model-test' && (!profile?.budget || tokens < profile.budget.min || tokens > profile.budget.max)) {
      throw new InvalidGoogleReasoningError(`Google model '${canonical}' does not have a verified budget range containing ${tokens}`);
    }
    thinkingConfig = { thinkingBudget: tokens };
  } else if (control.kind === 'adaptive') {
    if (!profile?.adaptive) throw new InvalidGoogleReasoningError(`Google model '${canonical}' has no verified adaptive thinking setting`);
    if (profile.adaptive !== 'upstream-default') thinkingConfig = profile.adaptive;
  }
  const maxOutputTokens = explicitMaxOutputTokens ?? (thinkingConfig ? profile?.defaultMaxOutputTokens : undefined);
  if (thinkingConfig && 'thinkingBudget' in thinkingConfig && thinkingConfig.thinkingBudget > 0 && profile?.budget?.requiresBudgetBelowOutputLimit) {
    if (maxOutputTokens === undefined) throw new InvalidGoogleReasoningError(`Google model '${canonical}' needs a max output token limit for its thinking budget`);
    if (thinkingConfig.thinkingBudget >= maxOutputTokens) {
      throw new InvalidGoogleReasoningError(`Google model '${canonical}' needs max output tokens greater than thinking budget ${thinkingConfig.thinkingBudget}`);
    }
  }
  return {
    model: canonical,
    ...(thinkingConfig ? { thinkingConfig } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(control.effort ? { effort: control.effort } : control.kind === 'disabled' ? { effort: 'none' as const } : {}),
    source,
    ...(allowedScopes ? { allowedScopes } : {}),
    requiresBudgetBelowOutputLimit: Boolean(profile?.budget?.requiresBudgetBelowOutputLimit)
  };
}

export function prepareGoogleAnthropicReasoning(req: AnthropicRequest, config: GoogleReasoningConfig): GooglePreparedReasoning {
  const max = positiveInteger(req.max_tokens, 'max_tokens');
  const effort = req.output_config?.effort as GoogleReasoningEffort | undefined;
  const thinking = req.thinking;
  const type = thinking?.type;
  if (thinking && !['enabled', 'adaptive', 'disabled'].includes(String(type))) {
    throw new InvalidGoogleReasoningError(`Unsupported Anthropic thinking.type '${type}'`);
  }
  const tokens = thinking?.budget_tokens;
  if (type === 'enabled') positiveInteger(tokens, 'thinking.budget_tokens');
  if (type === 'enabled' && tokens === undefined) throw new InvalidGoogleReasoningError('thinking.budget_tokens is required for enabled thinking');
  if ((type === 'adaptive' || type === 'disabled') && tokens !== undefined) {
    throw new InvalidGoogleReasoningError(`thinking.budget_tokens cannot be used with ${type} thinking`);
  }
  if (effort && !GOOGLE_EFFORTS.includes(effort)) throw new InvalidGoogleReasoningError(`Unsupported Google reasoning effort '${effort}'`);
  if (type === 'disabled' && effort && effort !== 'none') throw new InvalidGoogleReasoningError('disabled thinking conflicts with non-none effort');
  if ((type === 'enabled' || type === 'adaptive') && effort === 'none') throw new InvalidGoogleReasoningError(`${type} thinking conflicts with none effort`);
  if (effort) return resolve(req.model, 'output_config.effort', { kind: 'effort', effort }, max, config);
  if (type === 'disabled') return resolve(req.model, 'thinking.type', { kind: 'disabled' }, max, config);
  if (type === 'adaptive') return resolve(req.model, 'thinking.type', { kind: 'adaptive' }, max, config);
  if (type === 'enabled') return resolve(req.model, 'thinking.budget_tokens', { kind: 'budget', tokens }, max, config);
  return resolve(req.model, 'upstream-default', { kind: 'default' }, max, config);
}

export function prepareGoogleOpenAIReasoning(
  req: OpenAIChatRequest,
  config: GoogleReasoningConfig,
  internalBudget?: number
): GooglePreparedReasoning {
  const maxTokens = positiveInteger(req.max_tokens, 'max_tokens');
  const maxCompletionTokens = positiveInteger(req.max_completion_tokens, 'max_completion_tokens');
  if (maxTokens !== undefined && maxCompletionTokens !== undefined && maxTokens !== maxCompletionTokens) {
    throw new InvalidGoogleReasoningError('max_tokens and max_completion_tokens must match when both are supplied');
  }
  const max = maxCompletionTokens ?? maxTokens;
  const effort = req.reasoning_effort as GoogleReasoningEffort | undefined;
  if (effort !== undefined && !GOOGLE_EFFORTS.includes(effort)) throw new InvalidGoogleReasoningError(`Unsupported Google reasoning effort '${effort}'`);
  if (effort) return resolve(req.model, 'reasoning_effort', { kind: 'effort', effort }, max, config);
  if (internalBudget !== undefined) {
    positiveInteger(internalBudget, 'internal thinking budget');
    return resolve(req.model, 'model-test', { kind: 'budget', tokens: internalBudget }, max, config);
  }
  return resolve(req.model, 'upstream-default', { kind: 'default' }, max, config);
}
