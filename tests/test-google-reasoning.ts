import assert from 'node:assert/strict';
import {
  googleReasoningMetadata,
  prepareGoogleAnthropicReasoning,
  prepareGoogleOpenAIReasoning
} from '../src/providers/google/reasoning.ts';
import { buildGoogleCloudCodePayload } from '../src/providers/google/request-builder.ts';
import type { GoogleReasoningConfig, GoogleReasoningScope } from '../src/types.ts';

const scope: GoogleReasoningScope = {
  accountId: 'test-account', projectId: 'test-project',
  endpoint: 'https://daily-cloudcode-pa.googleapis.com', checkedAt: '2026-10-09T00:00:00Z'
};
const config: GoogleReasoningConfig = { models: {
  'gemini-2.5-flash': {
    effortMode: 'budget',
    effortMap: {
      low: { thinkingBudget: 2048 }, medium: { thinkingBudget: 8192 }, high: { thinkingBudget: 16384 }
    },
    evidence: { low: [scope], medium: [scope], high: [scope] },
    budget: { min: 2048, max: 16384, canDisable: false, canDynamic: false, requiresBudgetBelowOutputLimit: true },
    defaultMaxOutputTokens: 17408
  },
  'gemini-3.8-flash-tiered': {
    effortMode: 'level',
    effortMap: {
      low: { thinkingLevel: 'LOW' }, medium: { thinkingLevel: 'MEDIUM' }, high: { thinkingLevel: 'HIGH' }
    },
    evidence: { low: [scope], medium: [scope], high: [scope] },
    defaultMaxOutputTokens: 4096
  }
} };

const messages = [{ role: 'user' as const, content: 'OK' }];
const anthBase = { model: 'gemini-2.5-flash', messages, max_tokens: 17408 };
const chatBase = { model: 'gemini-2.5-flash', messages, max_tokens: 17408 };

const fromAnthropic = prepareGoogleAnthropicReasoning({
  ...anthBase, output_config: { effort: 'high' }
}, config);
const fromOpenAI = prepareGoogleOpenAIReasoning({
  ...chatBase, reasoning_effort: 'high'
}, config);
assert.deepEqual(fromAnthropic.thinkingConfig, { thinkingBudget: 16384 });
assert.deepEqual(fromOpenAI.thinkingConfig, fromAnthropic.thinkingConfig);
assert.deepEqual(fromAnthropic.allowedScopes, [scope]);
assert.equal(buildGoogleCloudCodePayload({ ...anthBase, output_config: { effort: 'high' } }, 'test-project', fromAnthropic)
  .request.generationConfig.thinkingConfig.thinkingBudget, 16384);

const level = prepareGoogleOpenAIReasoning({
  model: 'gemini-3.8-flash-tiered', messages, reasoning_effort: 'medium'
}, config);
assert.deepEqual(level.thinkingConfig, { thinkingLevel: 'MEDIUM' });
assert.equal(level.maxOutputTokens, 4096);
assert.deepEqual(buildGoogleCloudCodePayload({ model: level.model, messages }, 'test-project', level)
  .request.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
assert.equal(googleReasoningMetadata(level.model, config).reasoning_control, 'level');

const fallback = prepareGoogleOpenAIReasoning({ model: 'unprofiled-model', messages }, config);
assert.equal(fallback.thinkingConfig, undefined);
assert.throws(() => prepareGoogleOpenAIReasoning({ model: 'unprofiled-model', messages, reasoning_effort: 'low' }, config), /does not support configured effort/);
assert.throws(() => prepareGoogleOpenAIReasoning({ ...chatBase, reasoning_effort: 'none' }, config), /does not support configured effort/);
assert.throws(() => prepareGoogleOpenAIReasoning({ ...chatBase, reasoning_effort: 'high', max_tokens: 4096 }, config), /greater than thinking budget/);
assert.throws(() => prepareGoogleOpenAIReasoning({ ...chatBase, reasoning_effort: 'low', max_completion_tokens: 4096 }, config), /must match/);
assert.throws(() => prepareGoogleAnthropicReasoning({ ...anthBase, thinking: { type: 'disabled' }, output_config: { effort: 'high' } }, config), /conflicts/);
assert.throws(() => prepareGoogleAnthropicReasoning({ ...anthBase, thinking: { type: 'enabled', budget_tokens: 1000 } }, config), /verified budget range/);
assert.deepEqual(prepareGoogleAnthropicReasoning({ ...anthBase, thinking: { type: 'enabled', budget_tokens: 3000 } }, config).thinkingConfig, { thinkingBudget: 3000 });
assert.deepEqual(prepareGoogleAnthropicReasoning({ ...anthBase, thinking: { type: 'enabled', budget_tokens: 3000 }, output_config: { effort: 'high' } }, config).thinkingConfig, { thinkingBudget: 16384 });

console.log('Google reasoning checks passed: dual ingress mapping, PA payload, model metadata, defaults, conflicts, and budget boundaries.');
