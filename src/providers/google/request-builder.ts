import crypto from 'node:crypto';
import type { AnthropicRequest, AnthropicContentPart, GooglePreparedReasoning } from '../../types.ts';
import type { GatewayRequestIR, UnifiedContentPart } from '../../protocol/ir.ts';
import { scrubClientIdentity, scrubText } from './scrubber.ts';
import { sanitizeGoogleSchema } from './schema-sanitizer.ts';
import { getCachedSignature, GEMINI_SKIP_SIGNATURE } from './signature-cache.ts';
import {
  cleanCacheControl,
  reorderAssistantContent,
  closeToolLoopForThinking
} from './thinking-recovery.ts';
import { getGoogleSessionId } from './session-manager.ts';

export const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  'You are Antigravity, a powerful agentic AI coding assistant designed by Google Deepmind.';

export const ANTIGRAVITY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.110.0 Chrome/120.0.6099.291 Electron/28.2.10 Safari/537.36',
  'Content-Type': 'application/json',
  'X-Client-Name': 'antigravity',
  'X-Client-Version': '1.110.0',
  'x-goog-api-client': 'gl-node/18.18.2 fire/0.8.6 grpc/1.10.x'
};

function convertContentToParts(
  content: string | AnthropicContentPart[] | UnifiedContentPart[],
  isGeminiModel: boolean,
  isClaudeModel: boolean
): any[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [{ text: String(content) }];
  }

  const parts: any[] = [];
  const deferredInlineData: any[] = [];

  for (const block of content) {
    if (!block) continue;

    if (block.type === 'text') {
      if (block.text && block.text.trim()) {
        parts.push({ text: block.text });
      }
    } else if (block.type === 'image') {
      const src = (block as any).source;
      if (src?.type === 'base64') {
        parts.push({
          inlineData: {
            mimeType: src.media_type || src.mediaType || 'image/jpeg',
            data: src.data
          }
        });
      } else if (src?.type === 'url') {
        parts.push({
          fileData: {
            mimeType: src.media_type || src.mediaType || 'image/jpeg',
            fileUri: src.url
          }
        });
      }
    } else if (block.type === 'tool_use' && (block as any).name) {
      const functionCall: any = {
        name: (block as any).name,
        args: (block as any).input || {}
      };

      if (isClaudeModel && (block as any).id) {
        functionCall.id = (block as any).id;
      }

      const part: any = { functionCall };

      // Attach thoughtSignature for Gemini 3+ models at part level only (priority: block signature > cache > skip fallback)
      if (isGeminiModel) {
        const toolId = (block as any).id;
        const signature =
          (block as any).thoughtSignature ||
          (block as any).thought_signature ||
          (toolId ? getCachedSignature(toolId) : null) ||
          GEMINI_SKIP_SIGNATURE;

        part.thoughtSignature = signature;
      }

      parts.push(part);
    } else if (block.type === 'tool_result') {
      const toolId = (block as any).toolCallId || (block as any).tool_use_id || 'tool_response';
      const isError = (block as any).isError || (block as any).is_error || false;
      let textContent = '';
      const localImageParts: any[] = [];

      if (typeof block.content === 'string') {
        textContent = block.content;
      } else if (Array.isArray(block.content)) {
        for (const item of block.content as any[]) {
          if (!item) continue;
          if (item.type === 'image' && item.source?.type === 'base64') {
            localImageParts.push({
              inlineData: {
                mimeType: item.source.media_type || item.source.mediaType || 'image/jpeg',
                data: item.source.data
              }
            });
          } else if (item.type === 'text' && item.text) {
            textContent += (textContent ? '\n' : '') + item.text;
          }
        }
      } else {
        textContent = JSON.stringify(block.content || {});
      }

      const functionResponse: any = {
        name: toolId,
        response: {
          output: textContent || (localImageParts.length > 0 ? 'Image attached' : ''),
          is_error: isError
        }
      };

      if (isClaudeModel) {
        functionResponse.id = toolId;
      }

      parts.push({ functionResponse });

      // Defer inline images to the end of the parts array so all functionResponse parts stay consecutive (Issue #91)
      if (localImageParts.length > 0) {
        deferredInlineData.push(...localImageParts);
      }
    } else if (block.type === 'thinking' && block.thinking) {
      const thinkingPart: any = {
        text: block.thinking,
        thought: true
      };
      if ((block as any).signature) {
        thinkingPart.thoughtSignature = (block as any).signature;
      }
      parts.push(thinkingPart);
    }
  }

  // Append deferred image parts at the end of parts array
  if (deferredInlineData.length > 0) {
    parts.push(...deferredInlineData);
  }

  return parts;
}

/**
 * Detects whether a request is dedicated to web search (e.g. Claude Code web_search side-query,
 * or requests containing only web search tools).
 */
export function isWebSearchOnlyRequest(request: AnthropicRequest | GatewayRequestIR): boolean {
  const tools = request.tools || [];

  // 1. Anthropic server-side web search tool: type: 'web_search_20250305'
  const hasServerWebSearch = tools.some(
    (t: any) => t.type === 'web_search_20250305' || t.name === 'web_search_20250305'
  );
  if (hasServerWebSearch) return true;

  // 2. All tools provided are web search tools
  if (tools.length > 0) {
    const allWebSearch = tools.every((t: any) => {
      const name = (t.name || t.type || '').toLowerCase();
      return name === 'web_search' || name === 'websearch' || name === 'google_search' || name === 'googlesearch';
    });
    if (allWebSearch) return true;
  }

  // 3. Claude Code side-query pattern: "Perform a web search for the query:"
  const messages = request.messages || [];
  const lastMsg = messages[messages.length - 1];
  if (lastMsg) {
    const text = typeof lastMsg.content === 'string'
      ? lastMsg.content
      : Array.isArray(lastMsg.content)
        ? lastMsg.content.map((c: any) => c.text || '').join(' ')
        : '';
    if (/^Perform a web search for the query:/i.test(text.trim())) {
      return true;
    }
  }

  return false;
}

export function buildGoogleCloudCodePayload(
  request: AnthropicRequest | GatewayRequestIR,
  projectId: string,
  prepared?: GooglePreparedReasoning,
  accountKey?: string
): any {
  const modelName = request.model || '';
  const isClaudeModel = modelName.toLowerCase().includes('claude');
  const isGeminiModel = !isClaudeModel;
  const isThinking = Boolean(prepared?.thinkingConfig || (request as any).thinking);

  // 1. Pre-clean cache_control fields from all messages
  const cleanMessages = cleanCacheControl(request.messages || []);

  // 2. Apply thinking recovery for broken tool loops or interrupted tools
  const processedMessages = closeToolLoopForThinking(cleanMessages, isClaudeModel ? 'claude' : 'gemini');

  const contents: any[] = [];

  for (const msg of processedMessages) {
    let msgContent = msg.content;

    // For assistant messages, strictly reorder: Thinking ➔ Text ➔ ToolUse
    if ((msg.role === 'assistant' || msg.role === 'model') && Array.isArray(msgContent)) {
      msgContent = reorderAssistantContent(msgContent);
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = convertContentToParts(msgContent as any, isGeminiModel, isClaudeModel);

    // Google API requires at least one part per content message
    if (parts.length === 0) {
      parts.push({ text: '.' });
    }

    contents.push({ role, parts });
  }

  // 3. System instruction with anti-detection identity scrubbing
  const systemParts: any[] = [
    { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
    { text: `Please ignore the following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` }
  ];

  const rawSystem = (request as any).systemPrompt || (request as any).system;
  if (rawSystem) {
    if (typeof rawSystem === 'string') {
      systemParts.push({ text: scrubClientIdentity(rawSystem) });
    } else if (Array.isArray(rawSystem)) {
      for (const item of rawSystem) {
        if (item && item.text) {
          systemParts.push({ text: scrubClientIdentity(item.text) });
        }
      }
    }
  }

  // 4. Interleaved thinking hint for Claude thinking models with tools
  if (isClaudeModel && isThinking && request.tools && request.tools.length > 0) {
    const interleavedHint =
      'Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer.';
    const lastPart = systemParts[systemParts.length - 1];
    if (lastPart && lastPart.text) {
      lastPart.text = `${lastPart.text}\n\n${interleavedHint}`;
    } else {
      systemParts.push({ text: interleavedHint });
    }
  }

  // 5. Generation Config
  const generationConfig: Record<string, any> = {};
  const maxTokens = (request as any).maxTokens ?? (request as any).max_tokens;
  if (prepared?.maxOutputTokens !== undefined || maxTokens !== undefined) {
    generationConfig.maxOutputTokens = prepared?.maxOutputTokens ?? maxTokens;
  }
  if (request.temperature !== undefined) {
    generationConfig.temperature = request.temperature;
  }
  const topP = (request as any).topP ?? (request as any).top_p;
  if (topP !== undefined) {
    generationConfig.topP = topP;
  }
  const topK = (request as any).topK ?? (request as any).top_k;
  if (topK !== undefined) {
    generationConfig.topK = topK;
  }

  // Thinking budget / level configuration
  if (prepared) {
    if (prepared.thinkingConfig) generationConfig.thinkingConfig = prepared.thinkingConfig;
  } else if ((request as any).thinking?.type === 'enabled' && (request as any).thinking.budget_tokens !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: (request as any).thinking.budget_tokens };
  } else if ((request as any).thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: (request as any).thinkingBudget };
  }

  // Claude API constraint: maxOutputTokens must be strictly greater than thinking budget
  if (isClaudeModel && isThinking) {
    const budget =
      (generationConfig.thinkingConfig as any)?.thinkingBudget ||
      (request as any).thinking?.budget_tokens ||
      32000;
    if (generationConfig.maxOutputTokens && generationConfig.maxOutputTokens <= budget) {
      generationConfig.maxOutputTokens = budget + 8192;
    }
  }

  // Derive stable session ID for KV cache continuity
  const sessionId = getGoogleSessionId(accountKey);

  const googleRequest: Record<string, any> = {
    contents,
    sessionId,
    systemInstruction: {
      role: 'user',
      parts: systemParts
    },
    generationConfig
  };

  // Convert tools if provided or if request is a dedicated web search query
  if (isWebSearchOnlyRequest(request)) {
    googleRequest.tools = [
      {
        googleSearch: {}
      }
    ];
  } else if (request.tools && request.tools.length > 0) {
    const functionDeclarations = request.tools.map((tool: any) => ({
      name: tool.name || tool.type,
      description: scrubText(tool.description || ''),
      parameters: sanitizeGoogleSchema(tool.input_schema || tool.parameters || { type: 'object', properties: {} })
    }));

    googleRequest.tools = [
      {
        functionDeclarations
      }
    ];

    // For Claude models, enforce validated function calling
    if (isClaudeModel) {
      googleRequest.toolConfig = {
        functionCallingConfig: {
          mode: 'VALIDATED'
        }
      };
    }
  }

  // Wrap in Google Cloud Code PA envelope
  return {
    project: projectId,
    model: request.model,
    request: googleRequest,
    userAgent: 'antigravity',
    requestType: 'agent',
    requestId: 'agent-' + crypto.randomUUID()
  };
}
