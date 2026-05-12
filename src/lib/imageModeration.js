/**
 * Image moderation — STUB for now.
 *
 * Attempted v1 with nsfwjs + @tensorflow/tfjs. They use dynamic require() calls
 * webpack 4 (CRA) can't statically analyze, so the build failed. Reverting to
 * a no-op stub keeps the upload integration points wired so we can drop in
 * server-side Sightengine later without touching the call sites.
 *
 * Roadmap: Sprint 4D-3 follow-up will wire:
 *   1. Upload to a "pending-media" bucket
 *   2. Storage Webhook fires Edge Function
 *   3. Sightengine API classifies the image
 *   4. Clean → move to public "media" bucket; flagged → delete + ban user
 *
 * Until then, text moderation handles 90% of the abuse risk for a small beta,
 * and the admin queue at /admin/moderation lets us manually pull anything
 * inappropriate that slips through.
 */

export async function classifyImage(/* file, opts */) {
  // No-op pass-through. Upload sites that call this still work.
  return { ok: true, skipped: true };
}
