import { supabase } from './supabase';

/**
 * User-facing moderation: report a post or comment for admin review.
 *
 * Both calls go through SECURITY DEFINER Postgres functions
 * (public.report_post / public.report_comment) so the client can't bypass
 * the validation. The function:
 *   - rejects unauthenticated callers
 *   - rejects self-reports
 *   - rejects unknown reasons
 *   - idempotently inserts into content_reports (unique on (reporter, target))
 *   - flips is_flagged + flag_reason on the target so AdminModeration picks it up
 */

export const REPORT_REASONS = [
  { id: 'spam',          label: 'Spam',          description: 'Repeated unwanted content, scams, or promo' },
  { id: 'harassment',    label: 'Harassment',    description: 'Targeted hostility, threats, or bullying' },
  { id: 'inappropriate', label: 'Inappropriate', description: "Doesn't belong on Rinkd" },
  { id: 'other',         label: 'Other',         description: 'Use details to explain' },
];

const VALID_REASONS = new Set(REPORT_REASONS.map((r) => r.id));

function validateReason(reason) {
  if (!VALID_REASONS.has(reason)) {
    return { error: { message: 'Pick a reason.' } };
  }
  return null;
}

export async function reportPost(postId, reason, details = null) {
  const bad = validateReason(reason);
  if (bad) return bad;
  const { error } = await supabase.rpc('report_post', {
    target_id: postId,
    reason,
    details: details && String(details).trim() ? String(details).trim().slice(0, 500) : null,
  });
  return { error };
}

export async function reportComment(commentId, reason, details = null) {
  const bad = validateReason(reason);
  if (bad) return bad;
  const { error } = await supabase.rpc('report_comment', {
    target_id: commentId,
    reason,
    details: details && String(details).trim() ? String(details).trim().slice(0, 500) : null,
  });
  return { error };
}
