/**
 * Identity Scrubber for Google Provider
 * Re-exports the universal scrubber utility from src/utils/scrubber.ts
 */

export {
  IDENTITY_SCRUB_PATTERNS,
  scrubText,
  deepScrub,
  scrubClientIdentity
} from '../../utils/scrubber.ts';
