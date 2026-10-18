import type {
  AnthropicRequest,
  AnthropicContentPart,
  OpenAIChatRequest,
  OpenAIChatMessage
} from '../types.ts';
import type {
  GatewayRequestIR,
  UnifiedMessage,
  UnifiedContentPart,
  UnifiedTool
} from './ir.ts';

/**
 * Parses Anthropic Messages request into GatewayRequestIR
 */
export function parseAnthropicRequest(req: AnthropicRequest): GatewayRequestIR {
  let systemPrompt: string | undefined;
  if (typeof req.system === 'string' && req.system.trim()) {
    systemPrompt = req.system.trim();
  } else if (Array.isArray(req.system)) {
    systemPrompt = req.system.map(s => s.text || '').join('\n\n').trim() || undefined;
  }

  const messages: UnifiedMessage[] = [];

  for (const msg of req.messages || []) {
    const parts: UnifiedContentPart[] = [];

    if (typeof msg.content === 'string') {
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (!item) continue;

        if (item.type === 'text') {
          parts.push({ type: 'text', text: item.text || '' });
        } else if (item.type === 'image' && item.source) {
          parts.push({
            type: 'image',
            source: {
              type: item.source.type || 'url',
              mediaType: item.source.media_type,
              data: item.source.data,
              url: item.source.url
            }
          });
        } else if (item.type === 'tool_use') {
          parts.push({
            type: 'tool_use',
            id: item.id,
            name: item.name,
            input: item.input || {}
          });
        } else if (item.type === 'tool_result') {
          let outputText = '';
          if (typeof item.content === 'string') {
            outputText = item.content;
          } else if (Array.isArray(item.content)) {
            outputText = item.content
              .filter(p => p && p.type === 'text')
              .map(p => p.text)
              .join('\n');
          } else if (item.content) {
            outputText = JSON.stringify(item.content);
          }

          parts.push({
            type: 'tool_result',
            toolCallId: item.tool_use_id,
            content: outputText,
            isError: item.is_error
          });
        } else if (item.type === 'thinking') {
          parts.push({
            type: 'thinking',
            thinking: item.thinking || '',
            signature: item.signature
          });
        }
      }
    }

    const role = (msg.role === 'system' ? 'system' : msg.role) as UnifiedMessage['role'];
    messages.push({
      role,
      content: parts
    });
  }

  let tools: UnifiedTool[] | undefined;
  if (req.tools && req.tools.length > 0) {
    tools = req.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} }
    }));
  }

  const reasoningEffort = req.output_config?.effort;
  const thinkingBudget = req.thinking?.type === 'enabled' ? req.thinking.budget_tokens : undefined;

  return {
    model: req.model,
    systemPrompt,
    messages,
    tools,
    toolChoice: req.tool_choice,
    maxTokens: req.max_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    topK: req.top_k,
    stream: req.stream !== false,
    reasoningEffort,
    thinkingBudget,
    sourceProtocol: 'anthropic',
    rawRequest: req
  };
}

/**
 * Parses OpenAI Chat Completions request into GatewayRequestIR
 */
export function parseOpenAIChatRequest(req: OpenAIChatRequest): GatewayRequestIR {
  let systemPrompt: string | undefined;
  const messages: UnifiedMessage[] = [];

  for (const msg of req.messages || []) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (text) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
      }
      // Also preserve in messages for providers that distinguish mid-prompt developer items
      messages.push({
        role: msg.role,
        content: [{ type: 'text', text }]
      });
      continue;
    }

    if (msg.role === 'tool') {
      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: msg.tool_call_id || '',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }
        ]
      });
      continue;
    }

    const parts: UnifiedContentPart[] = [];

    // Assistant with tool calls
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      if (msg.content) {
        parts.push({
          type: 'text',
          text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        });
      }
      for (const tc of msg.tool_calls) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          parsedArgs = { raw: tc.function?.arguments };
        }

        parts.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || '',
          input: parsedArgs
        });
      }

      messages.push({
        role: 'assistant',
        content: parts
      });
      continue;
    }

    // Standard message
    if (typeof msg.content === 'string') {
      parts.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const p of msg.content) {
        if (!p) continue;
        if (p.type === 'text') {
          parts.push({ type: 'text', text: p.text || '' });
        } else if (p.type === 'image_url') {
          parts.push({
            type: 'image',
            source: {
              type: 'url',
              url: p.image_url?.url
            }
          });
        }
      }
    }

    messages.push({
      role: msg.role as UnifiedMessage['role'],
      content: parts
    });
  }

  let tools: UnifiedTool[] | undefined;
  if (req.tools && req.tools.length > 0) {
    tools = req.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters || { type: 'object', properties: {} }
    }));
  }

  return {
    model: req.model,
    systemPrompt,
    messages,
    tools,
    toolChoice: req.tool_choice,
    maxTokens: req.max_tokens ?? req.max_completion_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stream: req.stream !== false,
    reasoningEffort: req.reasoning_effort,
    sourceProtocol: 'openai',
    rawRequest: req
  };
}
