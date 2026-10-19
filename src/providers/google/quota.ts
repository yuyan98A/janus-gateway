import type { GoogleQuotaBucket, GoogleQuotaGroup } from './client.ts';

// Aligned with CPA Management Center fe296333's quota/constants.ts.
// Keep these separate from inference headers: legacy client UAs omit Gemini pools.
export const GOOGLE_QUOTA_ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com'
] as const;

export function googleQuotaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity/hub/2.23.0 darwin/arm64'
  };
}

function record(value: unknown): Record<string, any> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function parseGoogleQuotaPayload(value: unknown): Record<string, any> | undefined {
  const root = record(value);
  return root ? record(root.body) ?? root : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

function fraction(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return null;
  const percent = typeof raw === 'string' && raw.endsWith('%');
  const digits = percent ? raw.slice(0, -1).trim() : raw;
  if (digits === '') return null;
  const parsed = Number(digits) / (percent ? 100 : 1);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function parseGoogleQuotaGroups(payload: unknown): GoogleQuotaGroup[] {
  const data = record(payload);
  if (!Array.isArray(data?.groups)) return [];
  return data.groups.flatMap((value: unknown, groupIndex: number) => {
    const group = record(value);
    if (!group) return [];
    const displayName = text(group.displayName ?? group.display_name) || `Quota Group ${groupIndex + 1}`;
    const buckets: GoogleQuotaBucket[] = (Array.isArray(group.buckets) ? group.buckets : []).flatMap((value: unknown, bucketIndex: number) => {
      const bucket = record(value);
      if (!bucket) return [];
      const remainingFraction = fraction(bucket.remainingFraction ?? bucket.remaining_fraction);
      if (remainingFraction === null) return [];
      const rawWindow = text(bucket.window)?.toLowerCase() || '';
      const window = ['5h', 'five-hour', 'five_hour'].includes(rawWindow) ? '5h'
        : ['weekly', 'week'].includes(rawWindow) ? 'weekly' : rawWindow;
      const bucketId = text(bucket.bucketId ?? bucket.bucket_id) || `group-${groupIndex + 1}-${window || 'bucket'}-${bucketIndex + 1}`;
      const resetTime = text(bucket.resetTime ?? bucket.reset_time);
      return [{
        bucketId,
        displayName: text(bucket.displayName ?? bucket.display_name) || text(bucket.description) || window || bucketId,
        window,
        remainingFraction,
        remainingPercent: Math.round(remainingFraction * 10000) / 100,
        available: remainingFraction > 0,
        ...(resetTime && Number.isFinite(Date.parse(resetTime)) ? { resetTime } : {})
      }];
    });
    const order = (b: GoogleQuotaBucket) => b.window === '5h' ? 0 : b.window === 'weekly' ? 1 : 2;
    buckets.sort((a, b) => order(a) - order(b) || a.displayName.localeCompare(b.displayName));
    const weekly = buckets.find(b => b.window === 'weekly');
    if (weekly?.remainingFraction === 0) {
      for (const bucket of buckets) if (bucket.window === '5h') bucket.available = false;
    }
    return buckets.length ? [{ displayName, ...(text(group.description) ? { description: text(group.description) } : {}), buckets }] : [];
  });
}
