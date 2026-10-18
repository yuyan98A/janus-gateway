/**
 * Session Management for Google Cloud Code PA
 *
 * Derives and maintains stable session IDs per account to maximize
 * server-side KV Cache hits on Google Cloud Code PA TPU clusters.
 * Mimics the Antigravity IDE binary startup lifecycle.
 */

import crypto from 'node:crypto';

const runtimeSessionStore = new Map<string, string>();

/**
 * Generate a Session ID matching Antigravity IDE binary logic
 */
function generateBinaryStyleId(): string {
  return crypto.randomUUID() + Date.now().toString();
}

/**
 * Get or create a stable session ID for a given Google account
 */
export function getGoogleSessionId(accountKey?: string): string {
  if (!accountKey) {
    return generateBinaryStyleId();
  }

  const existing = runtimeSessionStore.get(accountKey);
  if (existing) {
    return existing;
  }

  const newId = generateBinaryStyleId();
  runtimeSessionStore.set(accountKey, newId);
  return newId;
}

/**
 * Clear stored session IDs (useful for testing or cache reset)
 */
export function clearGoogleSessionStore(): void {
  runtimeSessionStore.clear();
}
