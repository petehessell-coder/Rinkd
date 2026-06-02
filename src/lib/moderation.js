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

/**
 * Director / commissioner / team-manager moderation (DIR-MOD-1). Soft-hides a
 * post or comment in the caller's OWN event — flips is_hidden so it drops from
 * every feed (reversible). Authorization is re-derived server-side from the
 * target's scope by the SECURITY DEFINER RPCs set_post_hidden / set_comment_hidden;
 * the client can't claim a role it doesn't hold (a `forbidden` error comes back).
 */
export async function hidePost(postId, hidden = true) {
  const { error } = await supabase.rpc('set_post_hidden', { p_post_id: postId, p_hidden: hidden });
  return { error };
}

export async function hideComment(commentId, hidden = true) {
  const { error } = await supabase.rpc('set_comment_hidden', { p_comment_id: commentId, p_hidden: hidden });
  return { error };
}
