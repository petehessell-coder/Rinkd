// A1 (feed-engagement) — recap-card data access.
//
// One server-side assembler (the get_game_recap_card RPC, deployed) returns the
// full payload the RINKD GAME RECAP card needs for any game source. The card
// component (components/RecapCard) renders it over /public/recap-card-bg2.png.
//
// Payload shape:
//   { game_id, source, date, rink, home_score, away_score,
//     home:{name,logo_initials,logo_color,has_logo}, away:{...},
//     goals:[{side:'H'|'A', jersey, period, time, name}],
//     shots_home, shots_away, pim_home, pim_away, saves_home, saves_away,
//     period_scores:[{period, side, goals}], stats_available }
// (team-source games are score-only: stats_available=false, goals=[].)

import { supabase } from './supabase';
import { getActivePlacements, pickByWeight } from './ads';

export async function getRecapCard(gameId, source) {
  if (!gameId || !source) {
    return { data: null, error: new Error('getRecapCard requires gameId + source') };
  }
  const { data, error } = await supabase.rpc('get_game_recap_card', {
    p_game_id: gameId,
    p_source: source,
  });
  return { data, error };
}

// The recap reuses the EVENT's sponsor (ad_placements). Selling one event
// sponsor lights up the recaps too. Prefers a recap-specific slot, then the
// event banner, then any active placement. Returns null → card shows RINKD.
export async function getRecapSponsor(ownerType, ownerId) {
  if (!ownerType || !ownerId || ownerType === 'team') return null;
  try {
    const placements = await getActivePlacements({ targetType: ownerType, targetId: ownerId });
    if (!placements.length) return null;
    const recap = placements.filter((p) => p.slot === 'recap_presented');
    const banner = placements.filter((p) => p.slot === 'event_banner');
    const pick = pickByWeight(recap.length ? recap : banner.length ? banner : placements);
    if (!pick || !pick.creative) return null;
    return { name: pick.creative.sponsor_name || null, imageUrl: pick.creative.image_url || null, linkUrl: pick.creative.link_url || null };
  } catch { return null; }
}

// Card payload + the event sponsor merged in (sponsorName/sponsorImageUrl/sponsorLinkUrl).
export async function getRecapCardWithSponsor(gameId, source) {
  const { data, error } = await getRecapCard(gameId, source);
  if (error || !data) return { data: null, error };
  const sponsor = await getRecapSponsor(data.owner_type, data.owner_id);
  if (sponsor) { data.sponsorName = sponsor.name; data.sponsorImageUrl = sponsor.imageUrl; data.sponsorLinkUrl = sponsor.linkUrl; }
  return { data, error: null };
}

// Recap posts carry the scoping ids — derive which game table to read.
export function recapSourceFromPost(post) {
  if (!post) return null;
  if (post.league_id) return 'league';
  if (post.tournament_id) return 'tournament';
  if (post.team_id) return 'team';
  return 'tournament';
}
