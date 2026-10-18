import type {
  AnthropicRequest,
  OpenAIChatRequest,
  ResponsesRequest,
  ResponsesInputItem,
  ResponsesTool,
  CodexReasoningEffort
} from '../../types.ts';
import type { GatewayRequestIR } from '../../protocol/ir.ts';
import { parseAnthropicRequest, parseOpenAIChatRequest } from '../../protocol/ingress.ts';
import { scrubText, deepScrub } from '../../utils/scrubber.ts';

export class CodexRequestAdapter {
  /**
   * Return model name directly without alias mapping
   */
  public static mapModel(model: string): string {
    return model;
  }

  /**
   * Convert Canonical GatewayRequestIR into OpenAI Responses API request
   */
  public static fromIR(ir: GatewayRequestIR, reasoningEffort?: CodexReasoningEffort): ResponsesRequest {
    let instructions = 'You are a helpful assistant.';
    if (ir.systemPrompt && ir.systemPrompt.trim()) {
      instructions = scrubText(ir.systemPrompt.trim());
    }

    const input: ResponsesInputItem[] = [];

    for (const msg of ir.messages || []) {
      // Codex's Responses endpoint rejects `system` input items. Claude Code and
      // OpenAI clients may send mid-conversation system reminders in messages[],
      // so preserve their position and instruction priority by translating to `developer`.
      const role = (msg.role === 'system' ? 'developer' : msg.role) as 'developer' | 'user' | 'assistant';

      if (typeof msg.content === 'string') {
        if (msg.content) {
          input.push({
            type: 'message',
            role,
            content: [{ type: 'input_text', text: msg.content }]
          });
        }
        continue;
      }

      if (Array.isArray(msg.content)) {
        const textParts: Array<{ type: string; text?: string; image_url?: string }> = [];

        for (const part of msg.content) {
          if (!part) continue;

          if (part.type === 'text') {
            textParts.push({
              type: 'input_text',
              text: part.text || ''
            });
          } else if (part.type === 'image' && part.source) {
            let url = part.source.url;
            if (part.source.type === 'base64' && part.source.data) {
              url = `data:${part.source.mediaType || 'image/jpeg'};base64,${part.source.data}`;
            }
            if (url) {
              textParts.push({
                type: 'input_image',
                image_url: url
              });
            }
          } else if (part.type === 'tool_use') {
            if (textParts.length > 0) {
              input.push({
                type: 'message',
                role,
                content: [...textParts]
              });
              textParts.length = 0;
            }

            input.push({
              type: 'function_call',
              id: part.id,
              call_id: part.id,
              name: part.name,
              arguments: JSON.stringify(part.input || {})
            });
          } else if (part.type === 'tool_result') {
            if (textParts.length > 0) {
              input.push({
                type: 'message',
                role,
                content: [...textParts]
              });
              textParts.length = 0;
            }

            input.push({
              type: 'function_call_output',
              call_id: part.toolCallId,
              output: part.content || ''
            });
          }
        }

        if (textParts.length > 0) {
          input.push({
            type: 'message',
            role,
            content: textParts
          });
        }
      }
    }

    let tools: ResponsesTool[] | undefined;
    if (ir.tools && ir.tools.length > 0) {
      tools = ir.tools.map(t => ({
        type: 'function',
        name: t.name,
        description: scrubText(t.description || ''),
        parameters: t.parameters
      }));
    }

    return {
      model: this.mapModel(ir.model),
      instructions,
      input,
      tools,
      tool_choice: ir.toolChoice ? (ir.toolChoice.type === 'auto' ? 'auto' : ir.toolChoice) : undefined,
      temperature: ir.temperature,
      top_p: ir.topP,
      max_output_tokens: ir.maxTokens,
      reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
      stream: true,
      store: false
    };
  }

  /**
   * Convert Anthropic Messages request to OpenAI Responses API request
   */
  public static fromAnthropic(req: AnthropicRequest, reasoningEffort?: CodexReasoningEffort): ResponsesRequest {
    return this.fromIR(parseAnthropicRequest(req), reasoningEffort);
  }

  /**
   * Convert OpenAI Chat Completions request to OpenAI Responses API request
   */
  public static fromOpenAIChat(req: OpenAIChatRequest, reasoningEffort?: CodexReasoningEffort): ResponsesRequest {
    return this.fromIR(parseOpenAIChatRequest(req), reasoningEffort);
  }
}
