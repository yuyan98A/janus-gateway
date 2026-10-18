/**
 * Thinking Recovery and Message Order Normalizer for Google Cloud Code PA
 *
 * Adapted from antigravity-claude-proxy (acc).
 * Enforces strict Protobuf message ordering and heals damaged tool loop states.
 */

import { MIN_SIGNATURE_LENGTH, getCachedSignatureFamily } from './signature-cache.ts';

/**
 * Remove cache_control fields from all content blocks in messages.
 * Prevents Google PA from rejecting with "Extra inputs are not permitted".
 */
export function cleanCacheControl(messages: any[]): any[] {
  if (!Array.isArray(messages)) return messages;

  return messages.map(msg => {
    if (!msg || typeof msg !== 'object') return msg;
    if (typeof msg.content === 'string') return msg;
    if (!Array.isArray(msg.content)) return msg;

    const cleanedContent = msg.content.map((block: any) => {
      if (!block || typeof block !== 'object') return block;
      if (block.cache_control === undefined) return block;
      const { cache_control, ...rest } = block;
      return rest;
    });

    return { ...msg, content: cleanedContent };
  });
}

function isThinkingPart(block: any): boolean {
  if (!block) return false;
  return (
    block.type === 'thinking' ||
    block.type === 'redacted_thinking' ||
    block.thinking !== undefined ||
    block.thought === true
  );
}

function hasValidSignature(block: any): boolean {
  const sig = block.thought === true ? block.thoughtSignature : block.signature;
  return typeof sig === 'string' && sig.length >= MIN_SIGNATURE_LENGTH;
}

/**
 * Reorders assistant content so that:
 * 1. Thinking blocks come first (required by Google Cloud Code PA)
 * 2. Text blocks come in the middle (dropping empty/whitespace blocks)
 * 3. Tool_use / functionCall blocks come at the end
 */
export function reorderAssistantContent(content: any[]): any[] {
  if (!Array.isArray(content) || content.length <= 1) return content;

  const thinkingBlocks: any[] = [];
  const textBlocks: any[] = [];
  const toolUseBlocks: any[] = [];
  const otherBlocks: any[] = [];

  for (const block of content) {
    if (!block) continue;
    if (isThinkingPart(block)) {
      thinkingBlocks.push(block);
    } else if (block.type === 'tool_use' || block.functionCall) {
      toolUseBlocks.push(block);
    } else if (block.type === 'text') {
      if (typeof block.text === 'string' && block.text.trim().length > 0) {
        textBlocks.push(block);
      }
    } else {
      otherBlocks.push(block);
    }
  }

  return [...thinkingBlocks, ...textBlocks, ...otherBlocks, ...toolUseBlocks];
}

interface ConversationState {
  inToolLoop: boolean;
  interruptedTool: boolean;
  turnHasThinking: boolean;
  toolResultCount: number;
  lastAssistantIdx: number;
}

function messageHasToolUse(message: any): boolean {
  const content = message?.content || message?.parts || [];
  if (!Array.isArray(content)) return false;
  return content.some((block: any) => block?.type === 'tool_use' || block?.functionCall);
}

function messageHasToolResult(message: any): boolean {
  const content = message?.content || message?.parts || [];
  if (!Array.isArray(content)) return false;
  return content.some((block: any) => block?.type === 'tool_result' || block?.functionResponse);
}

function isPlainUserMessage(message: any): boolean {
  if (message?.role !== 'user') return false;
  const content = message?.content || message?.parts || [];
  if (!Array.isArray(content)) return typeof content === 'string';
  return !content.some((block: any) => block?.type === 'tool_result' || block?.functionResponse);
}

function messageHasValidThinking(message: any): boolean {
  const content = message?.content || message?.parts || [];
  if (!Array.isArray(content)) return false;
  return content.some((block: any) => {
    if (!isThinkingPart(block)) return false;
    return hasValidSignature(block);
  });
}

function analyzeConversationState(messages: any[]): ConversationState {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { inToolLoop: false, interruptedTool: false, turnHasThinking: false, toolResultCount: 0, lastAssistantIdx: -1 };
  }

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant' || messages[i]?.role === 'model') {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return { inToolLoop: false, interruptedTool: false, turnHasThinking: false, toolResultCount: 0, lastAssistantIdx: -1 };
  }

  const lastAssistant = messages[lastAssistantIdx];
  const hasToolUse = messageHasToolUse(lastAssistant);
  const hasThinking = messageHasValidThinking(lastAssistant);

  let toolResultCount = 0;
  let hasPlainUserMessageAfter = false;
  for (let i = lastAssistantIdx + 1; i < messages.length; i++) {
    if (messageHasToolResult(messages[i])) {
      toolResultCount++;
    }
    if (isPlainUserMessage(messages[i])) {
      hasPlainUserMessageAfter = true;
    }
  }

  const inToolLoop = hasToolUse && toolResultCount > 0;
  const interruptedTool = hasToolUse && toolResultCount === 0 && hasPlainUserMessageAfter;

  return {
    inToolLoop,
    interruptedTool,
    turnHasThinking: hasThinking,
    toolResultCount,
    lastAssistantIdx
  };
}

/**
 * Recovers corrupted tool loops or interrupted tool calls by injecting
 * synthetic message boundaries to reset Google PA's conversational state machine.
 */
export function closeToolLoopForThinking(messages: any[], targetFamily: 'claude' | 'gemini'): any[] {
  const state = analyzeConversationState(messages);

  if (!state.inToolLoop && !state.interruptedTool) {
    return messages;
  }

  // If the turn already has valid thinking, recovery is not needed
  if (state.turnHasThinking) {
    return messages;
  }

  const modified = [...messages];

  if (state.interruptedTool) {
    // User interrupted the tool execution with a new prompt
    const insertIdx = state.lastAssistantIdx + 1;
    modified.splice(insertIdx, 0, {
      role: 'assistant',
      content: [{ type: 'text', text: '[Tool call was interrupted.]' }]
    });
  } else if (state.inToolLoop) {
    // Missing thinking blocks in tool loop
    const syntheticText =
      state.toolResultCount === 1
        ? '[Tool execution completed.]'
        : `[${state.toolResultCount} tool executions completed.]`;

    modified.push({
      role: 'assistant',
      content: [{ type: 'text', text: syntheticText }]
    });

    modified.push({
      role: 'user',
      content: [{ type: 'text', text: '[Continue]' }]
    });
  }

  return modified;
}
