// =============================================================================
// format.js — the one place numbers, counts, and times get turned into strings.
//
// Kills the ad-hoc `${n} goal${n===1?'':'s'}` ternaries and stray
// `.toLocaleString()` calls scattered across the app. Import from here:
//   import { number, plural, relativeTime } from '../lib/format';
// =============================================================================

// number(1234) -> "1,234". Thousands separators, no decimals. Non-finite or
// null/undefined falls back to "0" so a missing stat never renders "NaN".
export function number(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// plural(2, 'goal') -> "2 goals" · plural(1, 'goal') -> "1 goal"
// plural(3, 'assist') -> "3 assists" · plural(2, 'loss', 'losses') -> "2 losses"
// Returns the count (comma-formatted) + the correctly-pluralized noun. Pass an
// explicit pluralForm for irregular words; otherwise it appends "s".
export function plural(n, singular, pluralForm) {
  const v = typeof n === 'number' ? n : Number(n);
  const count = Number.isFinite(v) ? v : 0;
  const word = Math.abs(count) === 1 ? singular : (pluralForm || `${singular}s`);
  return `${number(count)} ${word}`;
}

// relativeTime(dateStr) -> compact "5s" / "3m" / "2h" / "4d" (then weeks).
// Matches the old posts.timeAgo output so existing call sites are unchanged;
// accepts a date string, a Date, or an epoch ms number. Invalid input -> "".
export function relativeTime(input) {
  if (input == null) return '';
  const date = input instanceof Date ? input : new Date(input);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return '';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 0) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}
