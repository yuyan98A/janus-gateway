import type {
  AnthropicRequest,
  CodexReasoningConfig,
  CodexReasoningEffort,
  OpenAIChatRequest
} from '../../types.ts';
import { CodexRequestAdapter } from './request-adapter.ts';

const VALID_EFFORTS: CodexReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export class InvalidReasoningRequestError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidReasoningRequestError';
  }
}

export function resolveOpenAIReasoning(
  model: string,
  request: OpenAIChatRequest,
  config: CodexReasoningConfig
): CodexReasoningEffort | undefined {
  if (request.reasoning_effort === undefined) return undefined;
  return validateModelEffort(model, request.reasoning_effort, config);
}

export function resolveAnthropicReasoning(
  model: string,
  request: AnthropicRequest,
  config: CodexReasoningConfig
): CodexReasoningEffort | undefined {
  const thinking = request.thinking;
  const requestedEffort = request.output_config?.effort;

  if (requestedEffort !== undefined) {
    return validateModelEffort(model, requestedEffort, config);
  }

  if (!thinking) return undefined;

  if (thinking.type === 'adaptive') return undefined;
  if (thinking.type === 'disabled') return validateModelEffort(model, 'none', config);
  if (thinking.type !== 'enabled') {
    throw new InvalidReasoningRequestError(
      `Unsupported Anthropic thinking.type '${thinking.type}'. Use enabled, adaptive, or disabled.`
    );
  }

  const budgetTokens = thinking.budget_tokens;
  if (!Number.isInteger(budgetTokens) || Number(budgetTokens) < 1) {
    throw new InvalidReasoningRequestError('thinking.budget_tokens must be a positive integer when thinking.type is enabled');
  }

  const thresholds = config.anthropicBudget ?? { lowMaxTokens: 2000, mediumMaxTokens: 8000 };
  if (
    !Number.isInteger(thresholds.lowMaxTokens) ||
    !Number.isInteger(thresholds.mediumMaxTokens) ||
    thresholds.lowMaxTokens < 1 ||
    thresholds.mediumMaxTokens < thresholds.lowMaxTokens
  ) {
    throw new Error('Invalid Codex Anthropic thinking budget thresholds in configuration');
  }

  const effort: CodexReasoningEffort = budgetTokens <= thresholds.lowMaxTokens
    ? 'low'
    : budgetTokens <= thresholds.mediumMaxTokens
      ? 'medium'
      : 'high';
  return validateModelEffort(model, effort, config);
}

export function getCodexReasoningProfile(
  model: string,
  config: CodexReasoningConfig
): CodexReasoningConfig['models'][string] | undefined {
  const canonicalModel = CodexRequestAdapter.mapModel(model);
  const profile = config.models[canonicalModel] ?? config.models[model];
  if (!profile) return undefined;
  if (!Array.isArray(profile.efforts) || profile.efforts.some(effort => !VALID_EFFORTS.includes(effort))) {
    throw new Error(`Invalid reasoning efforts configured for Codex model '${canonicalModel}'`);
  }
  if (profile.default !== undefined && !profile.efforts.includes(profile.default)) {
    throw new Error(`Configured default reasoning effort for '${canonicalModel}' must be listed in efforts`);
  }
  return profile;
}

function validateModelEffort(
  model: string,
  effort: string,
  config: CodexReasoningConfig
): CodexReasoningEffort {
  if (!VALID_EFFORTS.includes(effort as CodexReasoningEffort)) {
    throw new InvalidReasoningRequestError(
      `Unsupported reasoning effort '${effort}'. Allowed values: ${VALID_EFFORTS.join(', ')}`
    );
  }

  const profile = getCodexReasoningProfile(model, config);
  if (!profile) {
    throw new InvalidReasoningRequestError(
      `Reasoning capabilities for model '${model}' are not configured. Probe the model, add its capabilities under providers.codex.reasoning.models, then retry.`
    );
  }

  if (!profile.efforts.includes(effort as CodexReasoningEffort)) {
    throw new InvalidReasoningRequestError(
      `Model '${model}' does not have verified support for reasoning effort '${effort}'. Supported values: ${profile.efforts.join(', ') || 'none configured'}`
    );
  }

  return effort as CodexReasoningEffort;
}
