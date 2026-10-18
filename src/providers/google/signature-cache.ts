/**
 * In-Memory Signature Cache for Google Gemini & Claude Models
 * 
 * Ported and adapted from antigravity-claude-proxy (acc).
 * Solves the critical issue where downstream clients (like Claude Code CLI)
 * strip non-standard thoughtSignature fields from tool_use blocks,
 * causing Google Cloud Code PA to throw 400 Bad Request on subsequent turns.
 */

export const GEMINI_SIGNATURE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MIN_SIGNATURE_LENGTH = 10;
export const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const toolSignatureCache = new Map<string, CacheEntry<string>>();
const thinkingSignatureCache = new Map<string, CacheEntry<string>>();

/**
 * Cache a thoughtSignature associated with a toolCallId / tool_use_id
 */
export function cacheSignature(toolUseId: string, signature: string): void {
  if (!toolUseId || !signature) return;
  toolSignatureCache.set(toolUseId, {
    value: signature,
    timestamp: Date.now()
  });
}

/**
 * Retrieve cached thoughtSignature for a toolCallId
 */
export function getCachedSignature(toolUseId: string): string | null {
  if (!toolUseId) return null;
  const entry = toolSignatureCache.get(toolUseId);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
    toolSignatureCache.delete(toolUseId);
    return null;
  }

  return entry.value;
}

/**
 * Cache a thinking block's signature along with the originating model family ('claude' or 'gemini')
 */
export function cacheThinkingSignature(signature: string, modelFamily: 'claude' | 'gemini'): void {
  if (!signature || signature.length < MIN_SIGNATURE_LENGTH) return;
  thinkingSignatureCache.set(signature, {
    value: modelFamily,
    timestamp: Date.now()
  });
}

/**
 * Get model family for a thinking block signature
 */
export function getCachedSignatureFamily(signature: string): 'claude' | 'gemini' | null {
  if (!signature) return null;
  const entry = thinkingSignatureCache.get(signature);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
    thinkingSignatureCache.delete(signature);
    return null;
  }

  return entry.value as 'claude' | 'gemini';
}

/**
 * Clear signature caches (useful for testing)
 */
export function clearSignatureCache(): void {
  toolSignatureCache.clear();
  thinkingSignatureCache.clear();
}
