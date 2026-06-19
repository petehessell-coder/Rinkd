import React from 'react';
import { C, colors, radii, shadows, type, font } from '../../lib/tokens';
import { Icon, BounceNumber, useExpand } from '../ui';

// =============================================================================
// LiveGameCard — the live float. A live game pinned to the top of the feed
// with the card-hero treatment (elevated surface, red ring + glow), a pulsing
// LIVE marker (manifesto "red light on, siren"), live scores that bounce on
// change, and a one-tap drop-in that expands into the game page.
// Reduced-motion disables the pulse.
// =============================================================================
let pulseInjected = false;
function ensurePulse() {
  if (pulseInjected || typeof document === 'undefined') return;
  pulseInjected = true;
  const el = document.createElement('style');
  el.textContent =
    '@keyframes rinkdGamedayLive{0%{opacity:0.9;transform:scale(1)}100%{opacity:0;transform:scale(2.6)}}' +
    '.rinkd-gameday-livering{animation:rinkdGamedayLive 1.5s ease-out infinite}' +
    '@media (prefers-reduced-motion: reduce){.rinkd-gameday-livering{animation:none;opacity:0}}';
  document.head.appendChild(el);
}

function LivePill() {
  ensurePulse();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: C.red, color: '#fff', padding: '4px 11px 4px 9px', borderRadius: radii.button, fontFamily: font.display, fontWeight: 900, fontStyle: 'italic', fontSize: 12, letterSpacing: '0.08em' }}>
      <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#fff' }} />
        <span className="rinkd-gameday-livering" style={{ position: 'absolute', inset: 0, borderRadius: 999, boxShadow: '0 0 0 2px #fff' }} />
      </span>
      LIVE
    </span>
  );
}

function TeamRow({ team, score, lead }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: lead === false ? 0.6 : 1 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, overflow: 'hidden', background: team.logoUrl ? `center/cover url(${team.logoUrl})` : colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font.display, fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: C.ice }}>
        {!team.logoUrl && (team.name || '?').slice(0, 2).toUpperCase()}
      </div>
      <span style={{ ...type.body, fontWeight: lead ? 800 : 600, color: C.ice, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
      <BounceNumber value={score ?? 0} style={{ fontFamily: font.display, fontStyle: 'italic', fontWeight: 900, fontSize: 28, lineHeight: 1, color: C.ice, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }} />
    </div>
  );
}

export default function LiveGameCard({ game, navigate }) {
  const expand = useExpand();
  const hs = game.homeScore ?? 0, as = game.awayScore ?? 0;

  return (
    <div
      onClick={(e) => expand(e, () => navigate(game.gameUrl), { bg: colors.surfaceElevated })}
      className="rinkd-pressable"
      style={{
        background: colors.surfaceElevated,
        border: '1px solid rgba(215,38,56,0.6)', boxShadow: shadows.live,
        borderRadius: radii.card, padding: 16, marginBottom: 12, cursor: 'pointer', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <LivePill />
        <span style={{ ...type.meta, color: C.steel, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.eventName}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TeamRow team={game.away} score={as} lead={as > hs ? true : as < hs ? false : null} />
        <TeamRow team={game.home} score={hs} lead={hs > as ? true : hs < as ? false : null} />
      </div>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: C.red, fontFamily: font.display, fontWeight: 900, fontStyle: 'italic', fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Drop in <Icon name="live" size={14} color={C.red} />
      </div>
    </div>
  );
}
