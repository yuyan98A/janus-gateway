import assert from 'node:assert';
import {
  cacheSignature,
  getCachedSignature,
  cacheThinkingSignature,
  getCachedSignatureFamily,
  clearSignatureCache,
  GEMINI_SKIP_SIGNATURE
} from '../src/providers/google/signature-cache.ts';
import {
  cleanCacheControl,
  reorderAssistantContent,
  closeToolLoopForThinking
} from '../src/providers/google/thinking-recovery.ts';
import { buildGoogleCloudCodePayload } from '../src/providers/google/request-builder.ts';
import { getGoogleSessionId, clearGoogleSessionStore } from '../src/providers/google/session-manager.ts';
import { parseGoogleStreamToUnified } from '../src/providers/google/sse-parser.ts';
import { toAnthropicEventStream, toOpenAIChatChunkStream } from '../src/protocol/egress.ts';

console.log('======================================================================');
console.log('🧪 Starting Google PA acc Enhancements Automated Verification Suite');
console.log('======================================================================');

// 1. SignatureCache Tests
console.log('• Testing [SignatureCache: tool thoughtSignature caching and retrieval]...');
clearSignatureCache();
cacheSignature('call_test_123', 'sig_abcdef123456');
assert.strictEqual(getCachedSignature('call_test_123'), 'sig_abcdef123456');
assert.strictEqual(getCachedSignature('non_existent'), null);

cacheThinkingSignature('sig_claude_thinking_123456', 'claude');
assert.strictEqual(getCachedSignatureFamily('sig_claude_thinking_123456'), 'claude');
console.log('  PASSED: Signature cache verified.');

// 2. cleanCacheControl Tests
console.log('• Testing [cleanCacheControl: Stripping cache_control fields]...');
const rawMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'World' }
    ]
  }
];
const cleanedMessages = cleanCacheControl(rawMessages);
assert.strictEqual((cleanedMessages[0].content[0] as any).cache_control, undefined);
assert.strictEqual(cleanedMessages[0].content[0].text, 'Hello');
console.log('  PASSED: cache_control successfully eradicated.');

// 3. reorderAssistantContent Tests
console.log('• Testing [reorderAssistantContent: Thinking ➔ Text ➔ ToolUse]...');
const unorderedContent = [
  { type: 'text', text: '' }, // Empty text should be pruned
  { type: 'tool_use', id: 'call_1', name: 'read_file', input: {} },
  { type: 'text', text: 'I am reading the file now.' },
  { type: 'thinking', thinking: 'Let me think first.' }
];
const reordered = reorderAssistantContent(unorderedContent);
assert.strictEqual(reordered[0].type, 'thinking');
assert.strictEqual(reordered[1].type, 'text');
assert.strictEqual(reordered[1].text, 'I am reading the file now.');
assert.strictEqual(reordered[2].type, 'tool_use');
assert.strictEqual(reordered.length, 3, 'Empty text block was pruned');
console.log('  PASSED: Assistant message ordering enforced.');

// 4. closeToolLoopForThinking Tests
console.log('• Testing [closeToolLoopForThinking: Tool Loop & Interruption Recovery]...');
// Case A: Interrupted Tool (tool_use followed by plain user message without tool_result)
const interruptedMessages = [
  {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'npm start' } }]
  },
  {
    role: 'user',
    content: 'Stop! Do something else.'
  }
];
const healedInterrupted = closeToolLoopForThinking(interruptedMessages, 'claude');
assert.strictEqual(healedInterrupted.length, 3);
assert.strictEqual(healedInterrupted[1].role, 'assistant');
assert.strictEqual(healedInterrupted[1].content[0].text, '[Tool call was interrupted.]');

// Case B: In Tool Loop without valid thinking blocks
const toolLoopMessages = [
  {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'call_1', name: 'bash', input: {} }]
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'output' }]
  }
];
const healedLoop = closeToolLoopForThinking(toolLoopMessages, 'gemini');
assert.strictEqual(healedLoop.length, 4);
assert.strictEqual(healedLoop[2].role, 'assistant');
assert.strictEqual(healedLoop[2].content[0].text, '[Tool execution completed.]');
assert.strictEqual(healedLoop[3].role, 'user');
assert.strictEqual(healedLoop[3].content[0].text, '[Continue]');
console.log('  PASSED: Thinking loop self-healing verified.');

// 5. buildGoogleCloudCodePayload Enhancements Tests
console.log('• Testing [buildGoogleCloudCodePayload: Signature recovery, Session ID, and Deferred Inline Images]...');
clearSignatureCache();
cacheSignature('call_tool_restore', 'sig_recovered_signature_999');

// Test Gemini Tool Use restores thoughtSignature
const geminiPayload = buildGoogleCloudCodePayload(
  {
    model: 'gemini-3.8-flash-tiered',
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_tool_restore',
            name: 'grep',
            input: { query: 'test' }
          }
        ]
      }
    ]
  },
  'project-123',
  undefined,
  'account_user_1'
);

const parts = geminiPayload.request.contents[0].parts;
assert.strictEqual(parts[0].thoughtSignature, 'sig_recovered_signature_999');
assert.strictEqual(parts[0].functionCall.thoughtSignature, undefined, 'functionCall must NOT contain thoughtSignature');
assert.ok(geminiPayload.request.sessionId, 'Session ID injected in payload');

// Test Deferred Inline Images in Tool Result
const toolResultPayload = buildGoogleCloudCodePayload(
  {
    model: 'gemini-3.8-flash-tiered',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_read_image',
            content: [
              { type: 'text', text: 'Image file loaded.' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
                }
              }
            ]
          },
          {
            type: 'tool_result',
            tool_use_id: 'call_read_status',
            content: 'Success'
          }
        ]
      }
    ]
  },
  'project-123'
);

const toolResultParts = toolResultPayload.request.contents[0].parts;
// Parts should have both functionResponse first, then the deferred image part last!
assert.strictEqual(toolResultParts[0].functionResponse.name, 'call_read_image');
assert.strictEqual(toolResultParts[1].functionResponse.name, 'call_read_status');
assert.strictEqual(toolResultParts[2].inlineData.mimeType, 'image/png');
console.log('  PASSED: Signature restoration & consecutive functionResponse with deferred images verified.');

// 6. Claude Thinking Model Constraints
console.log('• Testing [Claude Thinking Constraints: maxOutputTokens > budget & Interleaved Hint]...');
const claudePayload = buildGoogleCloudCodePayload(
  {
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    thinking: {
      budget_tokens: 24000
    },
    tools: [
      {
        name: 'test_tool',
        description: 'a test tool',
        input_schema: { type: 'object' }
      }
    ],
    messages: [{ role: 'user', content: 'Hello' }]
  },
  'project-123'
);

// maxOutputTokens must be adjusted to budget + 8192 = 32192
assert.strictEqual(claudePayload.request.generationConfig.maxOutputTokens, 32192);
assert.strictEqual(claudePayload.request.toolConfig.functionCallingConfig.mode, 'VALIDATED');
const systemParts = claudePayload.request.systemInstruction.parts;
const hasInterleavedHint = systemParts.some((p: any) => p.text?.includes('Interleaved thinking is enabled'));
assert.ok(hasInterleavedHint, 'Interleaved thinking system instruction injected');
console.log('  PASSED: Claude thinking constraints & validated toolConfig verified.');

// 7. SSE Stream Parser: Token Usage Deduction & Signature Extraction
console.log('• Testing [SSE Parser: Usage Cached Tokens Deduction & Signature Extraction]...');
clearSignatureCache();

// Synthetic Google Cloud Code PA SSE chunks
const rawChunks = [
  'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking...","thoughtSignature":"sig_stream_thought_888"}]}}],"usageMetadata":{"promptTokenCount":1000,"cachedContentTokenCount":800,"candidatesTokenCount":150}}}\n\n',
  'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"id":"call_dyn_777","name":"exec","args":{"cmd":"ls"}},"thoughtSignature":"sig_stream_tool_777"}]}}],"usageMetadata":{"promptTokenCount":1000,"cachedContentTokenCount":800,"candidatesTokenCount":200}}}\n\n',
  'data: [DONE]\n\n'
];

async function* createMockStream() {
  const encoder = new TextEncoder();
  for (const chunk of rawChunks) {
    yield encoder.encode(chunk);
  }
}

const mockReadable = new ReadableStream<Uint8Array>({
  async start(controller) {
    for await (const chunk of createMockStream()) {
      controller.enqueue(chunk);
    }
    controller.close();
  }
});

const irEvents: any[] = [];
for await (const ev of parseGoogleStreamToUnified(mockReadable, 'gemini-3.8-flash-tiered')) {
  irEvents.push(ev);
}

const startEv = irEvents.find(e => e.type === 'start');
assert.strictEqual(startEv.inputTokens, 200, 'inputTokens = promptTokens (1000) - cachedTokens (800) = 200');
assert.strictEqual(startEv.cacheReadTokens, 800);

const finishEv = irEvents.find(e => e.type === 'finish');
assert.strictEqual(finishEv.inputTokens, 200);
assert.strictEqual(finishEv.outputTokens, 200);
assert.strictEqual(finishEv.cacheReadTokens, 800);

// Check that thoughtSignature was stored in SignatureCache!
assert.strictEqual(getCachedSignature('call_dyn_777'), 'sig_stream_tool_777');
assert.strictEqual(getCachedSignatureFamily('sig_stream_thought_888'), 'gemini');
console.log('  PASSED: Usage token deduction and automatic stream signature caching verified.');

// 8. Egress Anthropic & OpenAI Token Usage Serialization
console.log('• Testing [Egress: Anthropic & OpenAI cacheReadTokens serialization]...');

async function* mockIREvents() {
  yield {
    type: 'start',
    id: 'msg_test',
    model: 'gemini-3.8-flash-tiered',
    inputTokens: 200,
    cacheReadTokens: 800
  };
  yield {
    type: 'text_delta',
    text: 'Hello!'
  };
  yield {
    type: 'finish',
    stopReason: 'end_turn',
    inputTokens: 200,
    outputTokens: 50,
    cacheReadTokens: 800
  };
}

const anthropicEvents: any[] = [];
for await (const ev of toAnthropicEventStream(mockIREvents() as any, 'gemini-3.8-flash-tiered')) {
  anthropicEvents.push(ev);
}

const anthropicStart = anthropicEvents.find(e => e.type === 'message_start');
assert.strictEqual(anthropicStart.message.usage.input_tokens, 200);
assert.strictEqual(anthropicStart.message.usage.cache_read_input_tokens, 800);

const anthropicDelta = anthropicEvents.find(e => e.type === 'message_delta');
assert.strictEqual(anthropicDelta.usage.cache_read_input_tokens, 800);

const openAiChunks: any[] = [];
for await (const chunk of toOpenAIChatChunkStream(mockIREvents() as any, 'gemini-3.8-flash-tiered')) {
  openAiChunks.push(chunk);
}

const finalChunk = openAiChunks[openAiChunks.length - 1];
assert.strictEqual(finalChunk.usage.prompt_tokens, 1000, 'OpenAI prompt_tokens = input (200) + cached (800) = 1000');
assert.strictEqual(finalChunk.usage.prompt_tokens_details.cached_tokens, 800);

console.log('  PASSED: Anthropic & OpenAI egress token usage serialization verified.');

console.log('======================================================================');
console.log('🎉 All Google PA acc Enhancements Tests Passed Successfully!');
console.log('======================================================================');
