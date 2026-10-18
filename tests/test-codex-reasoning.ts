import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CodexRequestAdapter } from '../src/providers/codex/request-adapter.ts';
import { CodexProviderClient } from '../src/providers/codex/client.ts';
import { resolveAnthropicReasoning, resolveOpenAIReasoning } from '../src/providers/codex/reasoning.ts';
import { handleReasoningProbe } from '../src/ingress/reasoning-probe.ts';
import { handleChat } from '../src/ingress/chat.ts';
import { handleMessages } from '../src/ingress/messages.ts';
import { loadConfig } from '../src/config.ts';
import type { CodexReasoningConfig } from '../src/types.ts';

const profiles: CodexReasoningConfig = {
  models: {
    'gpt-6.1-sol': { efforts: ['none', 'low', 'medium', 'high'], default: 'medium' },
    'gpt-5.5': { efforts: ['low', 'medium'] }
  },
  anthropicBudget: { lowMaxTokens: 2000, mediumMaxTokens: 8000 }
};

function testResolversAndAdapters(): void {
  assert.equal(resolveOpenAIReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: [], reasoning_effort: 'high'
  }, profiles), 'high');
  assert.equal(resolveOpenAIReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: []
  }, profiles), undefined);
  assert.throws(() => resolveOpenAIReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: [], reasoning_effort: 'xhigh'
  }, profiles), /does not have verified support/);
  assert.throws(() => resolveOpenAIReasoning('unconfigured-model', {
    model: 'unconfigured-model', messages: [], reasoning_effort: 'low'
  }, profiles), /not configured/);

  const budgetCases: Array<[number, string]> = [
    [1, 'low'], [2000, 'low'], [2001, 'medium'], [6000, 'medium'],
    [8000, 'medium'], [8001, 'high']
  ];
  for (const [budget_tokens, expected] of budgetCases) {
    assert.equal(resolveAnthropicReasoning('gpt-6.1-sol', {
      model: 'gpt-6.1-sol', max_tokens: 10000, messages: [],
      thinking: { type: 'enabled', budget_tokens }
    }, profiles), expected, `budget_tokens=${budget_tokens}`);
  }
  assert.equal(resolveAnthropicReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: [], thinking: { type: 'adaptive' }
  }, profiles), undefined);
  assert.equal(resolveAnthropicReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: [], thinking: { type: 'disabled' }
  }, profiles), 'none');
  assert.equal(resolveAnthropicReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: [], thinking: { type: 'enabled', budget_tokens: 6000 },
    output_config: { effort: 'high' }
  }, profiles), 'high', 'output_config.effort takes precedence over budget mapping');
  assert.throws(() => resolveAnthropicReasoning('gpt-6.1-sol', {
    model: 'gpt-6.1-sol', messages: [], thinking: { type: 'enabled', budget_tokens: 0 }
  }, profiles), /positive integer/);
  assert.throws(() => resolveAnthropicReasoning('gpt-5.5', {
    model: 'gpt-5.5', messages: [], thinking: { type: 'enabled', budget_tokens: 9000 }
  }, profiles), /does not have verified support/);

  const openaiPayload = CodexRequestAdapter.fromOpenAIChat({
    model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'test' }]
  }, 'high');
  assert.deepEqual(openaiPayload.reasoning, { effort: 'high' });
  const anthropicPayload = CodexRequestAdapter.fromAnthropic({
    model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'test' }]
  }, 'medium');
  assert.deepEqual(anthropicPayload.reasoning, { effort: 'medium' });
  assert.equal('reasoning' in JSON.parse(JSON.stringify(CodexRequestAdapter.fromOpenAIChat({
    model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'test' }]
  }))), false, 'unspecified effort is omitted from the upstream JSON payload');
}

async function testConfigAndModelsMetadata(tempDir: string): Promise<void> {
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    providers: { codex: { reasoning: { models: {
      'gpt-6.1-sol': { efforts: ['low', 'medium'], default: 'medium' },
      'codex': { efforts: ['low', 'medium'] }
    } } } }
  }));
  const loaded = loadConfig(configPath);
  assert.deepEqual(loaded.providers.codex.reasoning?.models['gpt-6.1-sol']?.efforts, ['low', 'medium']);
  assert.equal(loaded.providers.codex.reasoning?.anthropicBudget?.lowMaxTokens, 2000, 'reasoning defaults merge with partial config');

  const cachePath = path.join(tempDir, 'models_cache.json');
  const authPath = path.join(tempDir, 'auth.json');
  fs.writeFileSync(cachePath, JSON.stringify({ models: [{ slug: 'gpt-6.1-sol' }, { slug: 'codex' }] }));
  fs.writeFileSync(authPath, JSON.stringify({ tokens: { access_token: 'fake-test-token' } }));
  const client = new CodexProviderClient(authPath, 'http://127.0.0.1:1', cachePath, loaded.providers.codex.reasoning);
  const models = await client.listModels();
  const flagship = models.find(model => model.id === 'gpt-6.1-sol');
  assert.deepEqual(flagship?.reasoning_efforts, ['low', 'medium']);
  assert.equal(flagship?.reasoning_default, 'medium');
  const codexAlias = models.find(model => model.id === 'codex');
  assert.deepEqual(codexAlias?.reasoning_efforts, ['low', 'medium'], 'direct model exposes its own profile');

  const originalFetch = globalThis.fetch;
  const upstreamEfforts: string[] = [];
  const probeTokenLimits: number[] = [];
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    upstreamEfforts.push(payload.reasoning.effort);
    probeTokenLimits.push(payload.max_output_tokens);
    if (payload.reasoning.effort === 'high') {
      return new Response(JSON.stringify({ error: { message: 'unsupported reasoning_effort' } }), { status: 400 });
    }
    if (payload.reasoning.effort === 'minimal') {
      return new Response('quota unavailable', { status: 429 });
    }
    if (payload.reasoning.effort === 'none') {
      return new Response(JSON.stringify({ error: { message: "Invalid 'max_output_tokens': expected >= 16" } }), { status: 400 });
    }
    return new Response('data: [DONE]\n\n', { status: 200 });
  };
  try {
    assert.deepEqual(await client.probeReasoningEffort('gpt-6.1-sol', 'low'), {
      status: 'accepted', httpStatus: 200
    });
    assert.deepEqual(await client.probeReasoningEffort('gpt-6.1-sol', 'high'), {
      status: 'rejected', httpStatus: 400, error: 'unsupported reasoning_effort'
    });
    assert.deepEqual(await client.probeReasoningEffort('gpt-6.1-sol', 'minimal'), {
      status: 'failed', httpStatus: 429, error: 'quota unavailable'
    });
    assert.deepEqual(await client.probeReasoningEffort('gpt-6.1-sol', 'none'), {
      status: 'failed', httpStatus: 400, error: "Invalid 'max_output_tokens': expected >= 16"
    });
    assert.deepEqual(upstreamEfforts, ['low', 'high', 'minimal', 'none']);
    assert.deepEqual(probeTokenLimits, [16, 16, 16, 16], 'probe uses Codex minimum max_output_tokens');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testProbeHandler(): Promise<void> {
  const probed: string[] = [];
  const googleProbed: string[] = [];
  const fakeDispatcher = {
    listAllModels: async () => [{ id: 'gpt-6.1-sol' }, { id: 'claude-sonnet-4-6' }],
    resolveProvider: (model: string) => model.startsWith('gpt-') ? 'codex' : 'google',
    probeCodexReasoningEffort: async (_model: string, effort: string) => {
      probed.push(effort);
      if (effort === 'high') return { status: 'rejected', httpStatus: 400, error: 'unsupported' };
      return { status: 'accepted', httpStatus: 200 };
    },
    probeGoogleReasoningEffort: async (_model: string, effort: string) => {
      googleProbed.push(effort);
      return { status: 'accepted', scopes: [{ accountId: 'example', projectId: 'example', endpoint: 'example', checkedAt: new Date().toISOString() }], httpStatus: 200 };
    }
  };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    await handleReasoningProbe(res, fakeDispatcher as any, JSON.parse(Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol' })
    });
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.deepEqual(probed, ['low', 'medium', 'high'], 'default probe order is stable and sequential');
    assert.deepEqual(result.suggestedConfig.efforts, ['low', 'medium']);
    assert.equal(result.results[2].status, 'rejected');

    probed.length = 0;
    const invalid = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol', efforts: ['not-a-level'] })
    });
    assert.equal(invalid.status, 400);
    assert.equal(probed.length, 0, 'invalid effort must not call probe provider');

    const googleModel = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6' })
    });
    assert.equal(googleModel.status, 200, 'probe endpoint supports Google models');
    assert.equal(probed.length, 0);
    assert.deepEqual(googleProbed, ['low', 'medium', 'high']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function testPreStreamValidation(): Promise<void> {
  const rejectReasoning = () => {
    throw Object.assign(new Error('unsupported reasoning effort'), { statusCode: 400 });
  };
  const fakeDispatcher = {
    validateOpenAIReasoning: rejectReasoning,
    validateAnthropicReasoning: rejectReasoning,
    dispatchOpenAI: async function* () { throw new Error('dispatch must not run'); },
    dispatchAnthropic: async function* () { throw new Error('dispatch must not run'); }
  };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (req.url === '/v1/chat/completions') await handleChat(req, res, fakeDispatcher as any, body);
    else await handleMessages(req, res, fakeDispatcher as any, body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const [route, body] of [
      ['/v1/chat/completions', { model: 'gpt-6.1-sol', messages: [], reasoning_effort: 'high', stream: true }],
      ['/v1/messages', { model: 'gpt-6.1-sol', messages: [], thinking: { type: 'enabled', budget_tokens: 6000 }, stream: true }]
    ] as const) {
      const response = await fetch(`${url}${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      assert.equal(response.status, 400, `${route} rejects invalid effort before opening SSE`);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      assert.match(await response.text(), /unsupported reasoning effort/);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-reasoning-test-'));
  try {
    testResolversAndAdapters();
    await testConfigAndModelsMetadata(tempDir);
    await testProbeHandler();
    await testPreStreamValidation();
    console.log('Codex reasoning checks passed: mapping, validation, budget boundaries, metadata, probe API, and pre-stream HTTP errors.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
