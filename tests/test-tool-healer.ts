import assert from 'node:assert';
import { healGoogleToolCall } from '../src/providers/google/tool-healer.ts';
import { parseGoogleStreamToUnified } from '../src/providers/google/sse-parser.ts';

console.log('='.repeat(70));
console.log('🧪 Starting Tool Call Healer & Normalization Tests');
console.log('='.repeat(70));

// Test 1: EnterPlanMode with empty schema strips synthetic reason to {}
console.log('• Testing EnterPlanMode strips synthetic reason to {}...');
const enterPlanModeTools = [
  {
    name: 'EnterPlanMode',
    description: 'Enter plan mode',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
];

const enterPlanResult = healGoogleToolCall(
  'EnterPlanMode',
  { reason: 'User requested refactoring frontend web design' },
  enterPlanModeTools
);
assert.deepStrictEqual(enterPlanResult, {}, 'EnterPlanMode must return empty object {}');
console.log('  PASSED: EnterPlanMode correctly stripped to {}');

// Test 2: EnterPlanMode without tool definitions uses known empty tools set
console.log('• Testing EnterPlanMode fallback without tools list...');
const fallbackEmpty = healGoogleToolCall(
  'EnterPlanMode',
  { reason: 'Planning next steps' }
);
assert.deepStrictEqual(fallbackEmpty, {}, 'Known empty tool must return {}');
console.log('  PASSED: Fallback known empty tool returned {}');

// Test 3: Glob tool called with only path="public" auto-heals pattern="**/*"
console.log('• Testing Glob with only path="public" auto-heals pattern="**/*"...');
const globTools = [
  {
    name: 'Glob',
    description: 'Glob files',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' }
      },
      required: ['pattern']
    }
  }
];

const healedGlobPathOnly = healGoogleToolCall(
  'Glob',
  { path: 'public' },
  globTools
);
assert.strictEqual(healedGlobPathOnly.pattern, '**/*');
assert.strictEqual(healedGlobPathOnly.path, 'public');
console.log('  PASSED: Glob path-only auto-filled pattern="**/*"');

// Test 4: Glob tool called with path containing wildcards moves path to pattern
console.log('• Testing Glob with wildcard path moves path to pattern...');
const healedGlobWildcard = healGoogleToolCall(
  'Glob',
  { path: 'src/**/*.tsx' },
  globTools
);
assert.strictEqual(healedGlobWildcard.pattern, 'src/**/*.tsx');
assert.strictEqual(healedGlobWildcard.path, undefined);
console.log('  PASSED: Glob wildcard path cleanly extracted into pattern');

// Test 5: Glob tool called with valid pattern is preserved
console.log('• Testing Glob with already valid pattern is untouched...');
const validGlob = healGoogleToolCall(
  'Glob',
  { pattern: '*.json', path: 'config' },
  globTools
);
assert.strictEqual(validGlob.pattern, '*.json');
assert.strictEqual(validGlob.path, 'config');
console.log('  PASSED: Valid Glob call preserved');

// Test 6: Other Claude Code tools: TaskList, CronList empty schemas
console.log('• Testing TaskList and CronList strip synthetic arguments...');
assert.deepStrictEqual(healGoogleToolCall('TaskList', { reason: 'list tasks' }), {});
assert.deepStrictEqual(healGoogleToolCall('CronList', { reason: 'list cron' }), {});
console.log('  PASSED: TaskList and CronList stripped to {}');

// Test 7: Legitimate tools with reason property in schema retain reason
console.log('• Testing tool with declared reason property retains reason...');
const toolWithReason = [
  {
    name: 'ScheduleWakeup',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        delaySeconds: { type: 'number' }
      }
    }
  }
];
const legitimateReason = healGoogleToolCall(
  'ScheduleWakeup',
  { reason: 'Wait for deployment', delaySeconds: 30 },
  toolWithReason
);
assert.strictEqual(legitimateReason.reason, 'Wait for deployment');
assert.strictEqual(legitimateReason.delaySeconds, 30);
console.log('  PASSED: Declared reason property retained');

// Test 8: Grep, FileRead, Bash, WebSearch, WebFetch parameter normalization
console.log('• Testing Grep, FileRead, Bash, WebSearch, WebFetch parameter auto-healing...');
const grepHealed = healGoogleToolCall('Grep', { query: 'export function' });
assert.strictEqual(grepHealed.pattern, 'export function');
assert.strictEqual(grepHealed.query, undefined);

const fileReadHealed = healGoogleToolCall('FileRead', { path: '/abs/path.ts' });
assert.strictEqual(fileReadHealed.file_path, '/abs/path.ts');
assert.strictEqual(fileReadHealed.path, undefined);

const bashHealed = healGoogleToolCall('Bash', { cmd: 'git status' });
assert.strictEqual(bashHealed.command, 'git status');
assert.strictEqual(bashHealed.cmd, undefined);

const webSearchHealed = healGoogleToolCall('WebSearch', { search: 'Next.js 15 features' });
assert.strictEqual(webSearchHealed.query, 'Next.js 15 features');
assert.strictEqual(webSearchHealed.search, undefined);

const webFetchHealed = healGoogleToolCall('WebFetch', { link: 'https://example.com' });
assert.strictEqual(webFetchHealed.url, 'https://example.com');
assert.strictEqual(webFetchHealed.link, undefined);
assert.ok(webFetchHealed.prompt, 'Must supply fallback prompt');
console.log('  PASSED: Grep, FileRead, Bash, WebSearch, WebFetch parameters normalized');

// Test 9: End-to-end stream parsing with healGoogleToolCall integration
console.log('• Testing parseGoogleStreamToUnified streaming tool call healing...');
async function testStreamHealing() {
  const sseChunk = [
    'data: ' + JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'call_123',
                    name: 'EnterPlanMode',
                    args: { reason: 'Refactor UI' }
                  }
                }
              ]
            }
          }
        ]
      }
    }),
    '\n\n'
  ].join('');

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseChunk));
      controller.close();
    }
  });

  const events: any[] = [];
  for await (const ev of parseGoogleStreamToUnified(stream, 'gemini-3.8-flash-tiered', enterPlanModeTools)) {
    events.push(ev);
  }

  const deltaEvent = events.find((e) => e.type === 'tool_call_delta');
  assert.ok(deltaEvent, 'Must emit tool_call_delta event');
  assert.strictEqual(deltaEvent.argsDelta, '{}', 'Streamed argsDelta for EnterPlanMode must be "{}"');
}

await testStreamHealing();
console.log('  PASSED: Stream parser yielded "{}" for EnterPlanMode');

console.log('='.repeat(70));
console.log('🎉 All Tool Call Healer Tests Passed Successfully!');
console.log('='.repeat(70));
