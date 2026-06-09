// GROWTH-SHARE-1 — helpers for the login-less public game page + sharing.
//
// Centralizes the youth / COPPA guardrail so every surface reads ONE rule:
// the public page (M1), the OG edge function (M4), and the future Share button
// (M3) all gate on these. The flags ride tournaments.settings / leagues.settings
// JSONB (feature_profile + public_sharing) — no dedicated columns (see
// ARCH-DUAL-1: feature_profile rides in settings today).

// Public sharing is ON by default for adult events, OFF (opt-in) for youth.
// Locked Jun 8: youth_competitive defaults off; an org can explicitly opt in.
export function isPublicSharingEnabled(settings) {
  const s = settings || {};
  if (s.public_sharing === false) return false; // explicit kill-switch
  if (s.public_sharing === true) return true;   // explicit opt-in (youth may opt in)
  return s.feature_profile !== 'youth_competitive'; // default: adult ON, youth OFF
}

// Minors' names never auto-publish. Youth events render team + score only —
// no scorer names anywhere on the public surface.
export function areScorersHidden(settings) {
  return (settings || {}).feature_profile === 'youth_competitive';
}

// Parent-event visibility — mirrors the anon-read RLS gates so the public page
// never renders a game whose parent event isn't itself public.
export function isParentPublic({ isLeague, league, tournament }) {
  if (isLeague) return league?.is_public === true;
  return ['active', 'complete'].includes(tournament?.status);
}

// The login-less deep link a share points at. origin = '' yields a relative path.
export function gameShareUrl(isLeague, gameId, origin = '') {
  return `${origin}/${isLeague ? 'lg' : 'g'}/${gameId}`;
}

// The in-app (protected) route "Open in Rinkd" sends a signed-in user to.
// League games need ?type=league for GameDetail to read the right table.
export function gameAppUrl(isLeague, gameId) {
  return isLeague ? `/league-game/${gameId}?type=league` : `/game/${gameId}`;
}
