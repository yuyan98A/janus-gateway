/**
 * Unified Type Definitions for Agent Model Gateway
 */

// ======================== Anthropic API Types ========================

export interface AnthropicContentPart {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking' | 'redacted_thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  content?: string | AnthropicContentPart[];
  tool_use_id?: string;
  is_error?: boolean;
  thinking?: string;
  signature?: string;
  data?: string;
  source?: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AnthropicContentPart[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string };
  thinking?: {
    type?: string;
    budget_tokens?: number;
  };
  output_config?: {
    effort?: GoogleReasoningEffort;
  };
  stream?: boolean;
  metadata?: Record<string, any>;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentPart[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export type AnthropicEvent =
  | { type: 'message_start'; message: AnthropicResponse }
  | { type: 'content_block_start'; index: number; content_block: Partial<AnthropicContentPart> }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; thinking?: string; signature?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null; stop_sequence: string | null }; usage?: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'ping' };

// ======================== OpenAI API Types ========================

export interface OpenAIToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  strict?: boolean;
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIToolFunction;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: OpenAITool[];
  tool_choice?: any;
  reasoning_effort?: GoogleReasoningEffort;
  user?: string;
}

export interface OpenAIChatChunkDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface OpenAIChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIChatChunkDelta;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ======================== OpenAI Responses API Types (Codex Compute) ========================

export interface ResponsesInputItem {
  type: 'message' | 'function_call' | 'function_call_output';
  role?: 'user' | 'assistant' | 'system' | 'developer';
  content?: string | Array<{ type: string; text?: string; image_url?: string }>;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: ResponsesInputItem[];
  tools?: ResponsesTool[];
  tool_choice?: any;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  reasoning?: {
    effort: CodexReasoningEffort;
  };
  stream?: boolean;
  store?: boolean;
}

export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type GoogleReasoningEffort = CodexReasoningEffort | 'max';
export type GoogleThinkingConfig = { thinkingBudget: number } | { thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' };

export interface GoogleReasoningScope {
  accountId: string;
  projectId: string;
  endpoint: string;
  checkedAt: string;
}

export interface GoogleReasoningProfile {
  effortMode: 'budget' | 'level';
  effortMap: Partial<Record<GoogleReasoningEffort, GoogleThinkingConfig>>;
  evidence: Partial<Record<GoogleReasoningEffort, GoogleReasoningScope[]>>;
  budget?: {
    min: number;
    max: number;
    canDisable?: boolean;
    canDynamic?: boolean;
    requiresBudgetBelowOutputLimit?: boolean;
  };
  adaptive?: GoogleThinkingConfig | 'upstream-default';
  defaultMaxOutputTokens?: number;
}

export interface GoogleReasoningConfig {
  models: Record<string, GoogleReasoningProfile>;
}

export interface GooglePreparedReasoning {
  model: string;
  thinkingConfig?: GoogleThinkingConfig;
  maxOutputTokens?: number;
  effort?: GoogleReasoningEffort;
  source: string;
  allowedScopes?: GoogleReasoningScope[];
  requiresBudgetBelowOutputLimit?: boolean;
}

export interface CodexReasoningModelProfile {
  efforts: CodexReasoningEffort[];
  default?: CodexReasoningEffort;
}

export interface CodexReasoningConfig {
  models: Record<string, CodexReasoningModelProfile>;
  anthropicBudget?: {
    lowMaxTokens: number;
    mediumMaxTokens: number;
  };
}

// ======================== Gateway Configuration Types ========================

export type ProviderId = 'google' | 'codex';

export interface GatewayConfig {
  server: {
    port: number;
    apiKey: string;
    host: string;
  };
  providers: {
    google: {
      enabled: boolean;
      accountsPath: string;
      accountPool?: {
        autoReload?: boolean;
      };
      reasoning?: GoogleReasoningConfig;
    };
    codex: {
      enabled: boolean;
      authPath: string;
      baseURL: string;
      modelsCachePath?: string;
      reasoning?: CodexReasoningConfig;
    };
  };
  routes: Record<string, ProviderId>;
}

export type ModelCategory = 'chat' | 'code_completion' | 'image' | 'audio' | 'internal' | 'command' | 'review' | 'other';

export interface ModelListItem {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  category?: ModelCategory;
  description?: string;
  display_name?: string;
  quota_info?: {
    remaining_fraction?: number;
    reset_time?: string;
  };
  supports_thinking?: boolean;
  thinking_budget?: number;
  min_thinking_budget?: number;
  reasoning_efforts?: GoogleReasoningEffort[];
  reasoning_default?: CodexReasoningEffort;
  reasoning_control?: 'budget' | 'level';
  reasoning_verification?: 'pa-request-accepted';
  supports_thinking_budget?: boolean;
  supports_thinking_disable?: boolean;
}

export interface ModelDiffEntry {
  added: string[];
  removed: string[];
  modified: string[];
}

export interface ModelRefreshResult {
  updated: boolean;
  updatedAt: string;
  changes: {
    google?: ModelDiffEntry;
    codex?: ModelDiffEntry;
  };
  summary: string;
  counts: {
    total: number;
    google: number;
    codex: number;
  };
  data: ModelListItem[];
}

export interface ModelsCacheData {
  updatedAt: string;
  google: ModelListItem[];
  codex: ModelListItem[];
}
