/**
 * Universal Identity & Payload Scrubber
 * Neutralizes third-party AI product trademarks, competitor SDK footprints,
 * and billing headers that trigger upstream WAF 429/400 filters.
 */

export interface ScrubPattern {
  pattern: RegExp;
  replacement: string;
}

export const IDENTITY_SCRUB_PATTERNS: Array<[RegExp, string]> = [
  // 1. Telemetry and billing headers (strip completely)
  [/x-anthropic-billing-header:[^\n\r]*/gi, ''],
  [/x-anthropic-[a-z0-9_-]+:[^\n\r]*/gi, ''],

  // 2. Specific multi-word phrases (longest match priority)
  [/\bClaude Code Agent\b/gi, 'Coding Assistant'],
  [/\bClaude Code CLI\b/gi, 'Coding Assistant CLI'],
  [/\bClaude Code\b/gi, 'Coding Assistant'],
  [/\bClaude Agent SDK\b/gi, 'Agent SDK'],
  [/\bAnthropic's\b/gi, "AssistantCorp's"],
  [/\banthropic's\b/gi, "assistantcorp's"],
  [/\bNous Research\b/gi, 'the assistant team'],
  [/\bHermes Agent\b/gi, 'the assistant'],
  [/\bHermes\b/gi, 'the assistant'],

  // 3. Core competitor brand identities
  [/\bAnthropic\b/g, 'AssistantCorp'],
  [/\banthropic\b/g, 'assistantcorp'],
  [/\bANTHROPIC\b/g, 'ASSISTANTCORP'],
  [/Anthropic/gi, 'AssistantCorp']
];

/**
 * Scrubs string text against identity rules
 */
export function scrubText(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [pattern, replacement] of IDENTITY_SCRUB_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Recursively scrubs all strings in an object/array structure
 */
export function deepScrub<T>(value: T, seen = new WeakSet()): T {
  if (typeof value === 'string') {
    return scrubText(value) as unknown as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(item => deepScrub(item, seen)) as unknown as T;
  }

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    clean[k] = deepScrub(v, seen);
  }
  return clean as unknown as T;
}

/**
 * Backwards compatibility alias for existing code
 */
export const scrubClientIdentity = scrubText;
