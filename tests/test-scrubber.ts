import assert from 'node:assert/strict';
import { scrubText, deepScrub } from '../src/utils/scrubber.ts';
import { buildGoogleCloudCodePayload } from '../src/providers/google/request-builder.ts';
import { CodexRequestAdapter } from '../src/providers/codex/request-adapter.ts';
import type { GatewayRequestIR } from '../src/protocol/ir.ts';

console.log('🧪 Starting Universal Payload Scrubber & Anti-Detection Tests...\n');

// 1. Test basic text scrubbing
console.log('• Testing [scrubText: Brand and Trademark Neutralization]');
{
  const text1 = 'I am building an agent with Anthropic and anthropic and ANTHROPIC.';
  const res1 = scrubText(text1);
  assert.equal(res1, 'I am building an agent with AssistantCorp and assistantcorp and ASSISTANTCORP.');
  assert.ok(!res1.includes('Anthropic'));
  assert.ok(!res1.includes('anthropic'));

  const text2 = 'You are a Claude Code Agent using the Claude Agent SDK and Claude Code CLI.';
  const res2 = scrubText(text2);
  assert.ok(!res2.includes('Claude Code'));
  assert.ok(!res2.includes('Claude Agent SDK'));

  const text3 = 'x-anthropic-billing-header: cc_version=2.1.28\nHello world!';
  const res3 = scrubText(text3);
  assert.ok(!res3.includes('billing-header'));
  assert.ok(res3.includes('Hello world!'));

  const text4 = 'Model trained by Nous Research and Hermes Agent.';
  const res4 = scrubText(text4);
  assert.ok(!res4.includes('Nous Research'));
  assert.ok(!res4.includes('Hermes Agent'));

  console.log('  PASSED: Basic string scrub verified.');
}

// 2. Test deep recursive scrubbing on complex nested structures
console.log('• Testing [deepScrub: Recursive Nested Object & Array Sanitization]');
{
  const nestedPayload = {
    user: 'Alice',
    metadata: {
      client: 'Claude Code Agent',
      tags: ['Anthropic-sdk', 'production'],
      nested: {
        rawLog: 'Error from Anthropic server: x-anthropic-billing-header: cc=1'
      }
    },
    items: [
      { tool: 'bash', output: 'Installed @anthropic-ai/sdk successfully' }
    ]
  };

  const scrubbed = deepScrub(nestedPayload);
  assert.ok(!JSON.stringify(scrubbed).includes('Anthropic'));
  assert.ok(!JSON.stringify(scrubbed).includes('Claude Code'));
  assert.ok(!JSON.stringify(scrubbed).includes('billing-header'));
  assert.equal(scrubbed.user, 'Alice');

  console.log('  PASSED: Deep recursive traversal verified.');
}

// 3. Test Google PA request builder targeted tier scrubbing
console.log('• Testing [Google Cloud Code PA: Targeted System/Tool Scrub + Protected User Code]');
{
  const testIR: GatewayRequestIR = {
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are an agent built on Anthropic Claude Agent SDK.',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'import Anthropic from "@anthropic-ai/sdk";' }]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'bash',
            input: { command: 'npm install @anthropic-ai/sdk' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call_1',
            content: 'Success! Package Anthropic SDK installed.'
          }
        ]
      }
    ],
    tools: [
      {
        name: 'testTool',
        description: 'Tool created for Anthropic Claude environment',
        parameters: {
          type: 'object',
          properties: {
            $defs: { custom: { type: 'string' } },
            query: { type: 'string' }
          }
        }
      }
    ]
  };

  const paPayload = buildGoogleCloudCodePayload(testIR, 'test-project-123');

  // 1. High-risk zone: System instruction must be 100% neutralized
  const systemText = JSON.stringify(paPayload.request.systemInstruction);
  assert.ok(!systemText.includes('Anthropic'), 'System instruction should not contain Anthropic');
  assert.ok(!systemText.includes('Claude Agent SDK'), 'System instruction should not contain Claude Agent SDK');

  // 2. High-risk zone: Tools description scrubbed & schema sanitized
  const toolDeclarations = paPayload.request.tools[0].functionDeclarations;
  assert.ok(!toolDeclarations[0].description.includes('Anthropic'));
  assert.ok(toolDeclarations[0].description.includes('AssistantCorp'));
  assert.ok(!JSON.stringify(toolDeclarations[0].parameters).includes('$defs'));

  // 3. Protected zone: User code & tool arguments must remain 100% intact (zero side effects)
  const userText = paPayload.request.contents[0].parts[0].text;
  assert.equal(userText, 'import Anthropic from "@anthropic-ai/sdk";', 'User code must be preserved intact');

  const toolCommand = paPayload.request.contents[1].parts[0].functionCall.args.command;
  assert.equal(toolCommand, 'npm install @anthropic-ai/sdk', 'Tool command must be preserved intact');

  const toolOutput = paPayload.request.contents[2].parts[0].functionResponse.response.output;
  assert.equal(toolOutput, 'Success! Package Anthropic SDK installed.', 'Tool output must be preserved intact');

  console.log('  PASSED: Google Cloud Code PA targeted scrub & code preservation verified.');
}

// 4. Test Codex Responses API request adapter targeted scrubbing
console.log('• Testing [OpenAI Codex Responses: Targeted Instructions/Tool Scrub + Protected Input]');
{
  const testIR: GatewayRequestIR = {
    model: 'gpt-6.1-sol',
    systemPrompt: 'System instruction with Anthropic mentions',
    messages: [
      {
        role: 'user',
        content: 'import Anthropic from "@anthropic-ai/sdk";'
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_codex_1',
            name: 'read_file',
            input: { path: '/home/user/anthropic_config.json' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call_codex_1',
            content: 'Loaded Anthropic credentials'
          }
        ]
      }
    ],
    tools: [
      {
        name: 'codexTool',
        description: 'Tool for Anthropic agents',
        parameters: { type: 'object' }
      }
    ]
  };

  const codexPayload = CodexRequestAdapter.fromIR(testIR);

  // 1. High-risk zone: instructions & tool description scrubbed
  assert.ok(!codexPayload.instructions.includes('Anthropic'), 'Instructions should not contain Anthropic');
  assert.ok(codexPayload.instructions.includes('AssistantCorp'));
  assert.ok(codexPayload.tools![0].description.includes('AssistantCorp'));

  // 2. Protected zone: user input, file path, output preserved intact
  const inputMessage = codexPayload.input[0];
  assert.equal((inputMessage as any).content[0].text, 'import Anthropic from "@anthropic-ai/sdk";');

  const toolCall = codexPayload.input[1];
  assert.equal(JSON.parse((toolCall as any).arguments).path, '/home/user/anthropic_config.json');

  const toolResult = codexPayload.input[2];
  assert.equal((toolResult as any).output, 'Loaded Anthropic credentials');

  console.log('  PASSED: OpenAI Codex adapter targeted scrub & code preservation verified.');
}

console.log('\n======================================================================');
console.log('🎉 All Payload Scrubber & Anti-Detection Tests Passed Successfully!');
console.log('======================================================================\n');
