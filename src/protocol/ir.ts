/**
 * Canonical Agent Message Intermediate Representation (IR)
 * Standardizes messages, tools, and stream deltas across Anthropic, OpenAI,
 * Google Cloud Code PA, and Codex Responses formats.
 */

export interface UnifiedTextPart {
  type: 'text';
  text: string;
}

export interface UnifiedImagePart {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    mediaType?: string;
    data?: string;
    url?: string;
  };
}

export interface UnifiedToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface UnifiedToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface UnifiedThinkingPart {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export type UnifiedContentPart =
  | UnifiedTextPart
  | UnifiedImagePart
  | UnifiedToolUsePart
  | UnifiedToolResultPart
  | UnifiedThinkingPart;

export interface UnifiedMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string | UnifiedContentPart[];
}

export interface UnifiedTool {
  name: string;
  description?: string;
  parameters: Record<string, any>;
}

export interface GatewayRequestIR {
  model: string;
  systemPrompt?: string;
  messages: UnifiedMessage[];
  tools?: UnifiedTool[];
  toolChoice?: any;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stream: boolean;
  reasoningEffort?: string;
  thinkingBudget?: number;
  sourceProtocol: 'anthropic' | 'openai';
  rawRequest?: any;
}

export type GatewayStreamEventIR =
  | {
      type: 'start';
      id: string;
      model: string;
      inputTokens?: number;
      cacheReadTokens?: number;
    }
  | {
      type: 'thinking_start';
      index?: number;
    }
  | {
      type: 'thinking_delta';
      text: string;
      index?: number;
    }
  | {
      type: 'thinking_stop';
      signature?: string;
      index?: number;
    }
  | {
      type: 'signature_delta';
      signature: string;
      index?: number;
    }
  | {
      type: 'text_start';
      index?: number;
    }
  | {
      type: 'text_delta';
      text: string;
      index?: number;
    }
  | {
      type: 'text_stop';
      index?: number;
    }
  | {
      type: 'tool_call_start';
      id: string;
      name: string;
      index?: number;
    }
  | {
      type: 'tool_call_delta';
      argsDelta: string;
      id?: string;
      name?: string;
      index?: number;
    }
  | {
      type: 'tool_call_stop';
      id?: string;
      index?: number;
    }
  | {
      type: 'finish';
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    };
