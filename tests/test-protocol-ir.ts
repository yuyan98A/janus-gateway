import assert from 'node:assert/strict';
import {
  parseAnthropicRequest,
  parseOpenAIChatRequest,
  toAnthropicEventStream,
  toOpenAIChatChunkStream
} from '../src/protocol/index.ts';
import type { GatewayStreamEventIR } from '../src/protocol/index.ts';

async function testIngressParsing() {
  console.log('• Testing Ingress parsing: Anthropic to IR...');
  const anthReq = {
    model: 'test-model',
    system: [{ type: 'text' as const, text: 'System prompt' }],
    messages: [
      { role: 'user' as const, content: 'Hello' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'pondering' },
          { type: 'text' as const, text: 'Hi!' },
          { type: 'tool_use' as const, id: 'call_1', name: 'calc', input: { a: 1 } }
        ]
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'call_1', content: '2' }
        ]
      }
    ],
    tools: [
      { name: 'calc', description: 'calculate', input_schema: { type: 'object' } }
    ],
    output_config: { effort: 'high' as const },
    max_tokens: 1000
  };

  const ir1 = parseAnthropicRequest(anthReq);
  assert.equal(ir1.model, 'test-model');
  assert.equal(ir1.systemPrompt, 'System prompt');
  assert.equal(ir1.messages.length, 3);
  assert.equal(ir1.messages[1].role, 'assistant');
  const assistantParts = ir1.messages[1].content as any[];
  assert.equal(assistantParts[0].type, 'thinking');
  assert.equal(assistantParts[1].type, 'text');
  assert.equal(assistantParts[2].type, 'tool_use');
  assert.equal(ir1.tools?.length, 1);
  assert.equal(ir1.reasoningEffort, 'high');
  assert.equal(ir1.maxTokens, 1000);

  console.log('• Testing Ingress parsing: OpenAI to IR...');
  const openaiReq = {
    model: 'gpt-test',
    messages: [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Compute' },
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: [
          {
            id: 'call_2',
            type: 'function' as const,
            function: { name: 'add', arguments: '{"x":5}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'call_2', content: '5' }
    ],
    tools: [
      { type: 'function' as const, function: { name: 'add', description: 'add', parameters: {} } }
    ],
    reasoning_effort: 'medium'
  };

  const ir2 = parseOpenAIChatRequest(openaiReq);
  assert.equal(ir2.model, 'gpt-test');
  assert.equal(ir2.systemPrompt, 'You are helpful');
  assert.equal(ir2.reasoningEffort, 'medium');
  assert.equal(ir2.tools?.length, 1);
}

async function testEgressSerializers() {
  console.log('• Testing Egress serialization: IR Stream to Anthropic SSE...');
  async function* mockStream(): AsyncGenerator<GatewayStreamEventIR> {
    yield { type: 'start', id: 'msg_100', model: 'test-model', inputTokens: 50 };
    yield { type: 'thinking_start', index: 0 };
    yield { type: 'thinking_delta', text: 'thinking...', index: 0 };
    yield { type: 'thinking_stop', index: 0 };
    yield { type: 'text_start', index: 1 };
    yield { type: 'text_delta', text: 'Hello world', index: 1 };
    yield { type: 'text_stop', index: 1 };
    yield { type: 'tool_call_start', id: 'call_99', name: 'search', index: 2 };
    yield { type: 'tool_call_delta', argsDelta: '{"q": "query"}', index: 2 };
    yield { type: 'tool_call_stop', index: 2 };
    yield { type: 'finish', stopReason: 'tool_use', outputTokens: 25 };
  }

  const anthropicEvents: any[] = [];
  for await (const ev of toAnthropicEventStream(mockStream(), 'test-model')) {
    anthropicEvents.push(ev);
  }

  assert.equal(anthropicEvents[0].type, 'message_start');
  assert.equal(anthropicEvents[0].message.id, 'msg_100');
  assert.equal(anthropicEvents[0].message.usage.input_tokens, 50);

  const thinkingStart = anthropicEvents.find(e => e.type === 'content_block_start' && e.content_block?.type === 'thinking');
  assert(thinkingStart, 'Should emit thinking start');

  const textDelta = anthropicEvents.find(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta');
  assert.equal(textDelta?.delta?.text, 'Hello world');

  const toolDelta = anthropicEvents.find(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta');
  assert.equal(toolDelta?.delta?.partial_json, '{"q": "query"}');

  const deltaStop = anthropicEvents.find(e => e.type === 'message_delta');
  assert.equal(deltaStop?.delta?.stop_reason, 'tool_use');
  assert.equal(deltaStop?.usage?.output_tokens, 25);

  console.log('• Testing Egress serialization: IR Stream to OpenAI Chat Chunks...');
  const openaiChunks: any[] = [];
  for await (const chunk of toOpenAIChatChunkStream(mockStream(), 'test-model')) {
    openaiChunks.push(chunk);
  }

  const reasoningChunk = openaiChunks.find(c => c.choices?.[0]?.delta?.reasoning_content);
  assert.equal(reasoningChunk?.choices?.[0]?.delta?.reasoning_content, 'thinking...');

  const contentChunk = openaiChunks.find(c => c.choices?.[0]?.delta?.content);
  assert.equal(contentChunk?.choices?.[0]?.delta?.content, 'Hello world');

  const toolChunk = openaiChunks.find(c => c.choices?.[0]?.delta?.tool_calls);
  assert(toolChunk, 'Should emit tool call chunk');

  const finalChunk = openaiChunks[openaiChunks.length - 1];
  assert.equal(finalChunk?.choices?.[0]?.finish_reason, 'tool_calls');
  assert.equal(finalChunk?.usage?.completion_tokens, 25);
  assert.equal(finalChunk?.usage?.prompt_tokens, 50);

  console.log('Protocol IR unit tests passed successfully!');
}

async function main() {
  await testIngressParsing();
  await testEgressSerializers();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
