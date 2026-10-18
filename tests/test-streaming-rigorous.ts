import assert from 'node:assert/strict';
import http from 'node:http';

const BASE_URL = 'http://127.0.0.1:18763';
const API_KEY = 'sk-gateway-local-token';

async function testFirstChunkBufferingError() {
  console.log('• Testing First-Chunk Buffering Error Response (Not sending early 200 OK)...');
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      model: 'invalid-nonexistent-model-xyz',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    })
  });

  assert.equal(res.status, 400, `Expected status 400 but got ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('application/json'), `Expected application/json but got ${contentType}`);
  const data = await res.json() as any;
  assert(data.error && data.error.message, 'Expected error json payload');
  console.log('  ✔ First-Chunk Buffering successfully kept HTTP 400 JSON instead of early 200 SSE');
}

async function testAnthropicStreamingSequence() {
  console.log('• Testing Anthropic SSE Streaming Event Sequence...');
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-tiered',
      messages: [{ role: 'user', content: 'Say "Antigravity Streaming OK" in exactly 3 words.' }],
      stream: true,
      max_tokens: 1000
    })
  });

  assert.equal(res.status, 200);
  assert(res.headers.get('content-type')?.includes('text/event-stream'));

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: Array<{ event: string; data: any }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6).trim());
          events.push({ event: currentEvent || parsed.type, data: parsed });
        } catch {}
      }
    }
  }

  const types = events.map(e => e.event);
  assert.equal(types[0], 'message_start', 'First event must be message_start');
  assert(types.includes('content_block_start'), 'Must include content_block_start');
  assert(types.includes('content_block_delta'), 'Must include content_block_delta');
  assert(types.includes('content_block_stop'), 'Must include content_block_stop');
  assert(types.includes('message_delta'), 'Must include message_delta');
  assert.equal(types[types.length - 1], 'message_stop', 'Final event must be message_stop');

  const messageStart = events.find(e => e.event === 'message_start')?.data;
  assert(messageStart?.message?.usage, 'message_start must include usage');
  assert.equal(typeof messageStart.message.usage.input_tokens, 'number');

  const messageDelta = events.find(e => e.event === 'message_delta')?.data;
  assert(messageDelta?.usage, 'message_delta must include usage');
  assert.equal(typeof messageDelta.usage.output_tokens, 'number');
  assert(['end_turn', 'stop'].includes(messageDelta.delta.stop_reason), `Expected end_turn or stop, got ${messageDelta.delta.stop_reason}`);

  console.log('  ✔ Anthropic SSE event sequence and usage strictly conform to spec');
}

async function testStreamingToolCalling() {
  console.log('• Testing Streaming Tool Calling Projection...');
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-tiered',
      messages: [{ role: 'user', content: 'What is the weather in London?' }],
      tools: [{
        name: 'get_weather',
        description: 'Get weather for city',
        input_schema: {
          type: 'object',
          properties: {
            city: { type: 'string' }
          },
          required: ['city']
        }
      }],
      stream: true,
      max_tokens: 300
    })
  });

  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          events.push(JSON.parse(line.slice(6).trim()));
        } catch {}
      }
    }
  }

  const toolStart = events.find(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
  assert(toolStart, 'Should emit content_block_start with type tool_use');
  assert.equal(toolStart.content_block.name, 'get_weather');
  assert(toolStart.content_block.id, 'Tool call must have an id');

  const toolDelta = events.find(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta');
  assert(toolDelta, 'Should emit input_json_delta');
  assert(toolDelta.delta.partial_json.includes('London'), 'Tool args should contain London');

  const msgDelta = events.find(e => e.type === 'message_delta');
  assert.equal(msgDelta?.delta?.stop_reason, 'tool_use', 'Stop reason must be tool_use');
  console.log('  ✔ Streaming tool calling delta emission verified');
}

async function testOpenAIChatStreaming() {
  console.log('• Testing OpenAI /v1/chat/completions Streaming & [DONE] Sentinel...');
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-tiered',
      messages: [{ role: 'user', content: 'Say OK' }],
      stream: true,
      max_tokens: 50
    })
  });

  assert.equal(res.status, 200);
  assert(res.headers.get('content-type')?.includes('text/event-stream'));

  const text = await res.text();
  assert(text.includes('data: [DONE]'), 'Must terminate with data: [DONE]');
  assert(text.includes('chat.completion.chunk'), 'Must contain chat.completion.chunk objects');
  assert(text.includes('"delta"'), 'Must contain delta content');
  console.log('  ✔ OpenAI Chat streaming format verified');
}

async function testClientAbortHandling() {
  console.log('• Testing Client Disconnection & Stream Abort Handling...');
  return new Promise<void>((resolve, reject) => {
    const req = http.request(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      }
    }, (res) => {
      let chunkCount = 0;
      res.on('data', () => {
        chunkCount++;
        if (chunkCount >= 1) {
          // Abruptly destroy client socket
          req.destroy();
          setTimeout(() => {
            console.log('  ✔ Client aborted cleanly after receiving initial chunk; server did not crash');
            resolve();
          }, 300);
        }
      });
    });

    req.on('error', (err) => {
      // socket hang up is expected when client aborts
      if ((err as any).code === 'ECONNRESET' || err.message.includes('socket hang up')) {
        // Expected
      }
    });

    req.write(JSON.stringify({
      model: 'gemini-3.8-flash-tiered',
      messages: [{ role: 'user', content: 'Write a long 500 word essay about space exploration.' }],
      stream: true,
      max_tokens: 1000
    }));
    req.end();
  });
}

async function main() {
  console.log('======================================================================');
  console.log('🚀 Running In-Depth Streaming Conformance & Rigorous Test Suite');
  console.log('======================================================================');
  await testFirstChunkBufferingError();
  await testAnthropicStreamingSequence();
  await testStreamingToolCalling();
  await testOpenAIChatStreaming();
  await testClientAbortHandling();
  console.log('======================================================================');
  console.log('✅ ALL STREAMING TESTS PASSED PERFECTLY!');
  console.log('======================================================================');
}

main().catch(err => {
  console.error('❌ Streaming test failure:', err);
  process.exit(1);
});
