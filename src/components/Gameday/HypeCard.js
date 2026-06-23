import React, { useEffect, useState } from 'react';
import { C, colors, radii, type, font } from '../../lib/tokens';
import { Icon, useExpand } from '../ui';
import { getHeadToHead } from '../../lib/gameday';
import { getRsvp, upsertRsvp } from '../../lib/rsvp';
import { TeamLogo } from '../Logos';

// =============================================================================
// HypeCard — the pre-game surface. Manifesto: the feed has fresh content
// between games; this is the "pre-game warmup" beat of the game-day loop.
// Countdown + matchup + head-to-head record + (for your own games) an RSVP
// nudge. Tapping the card expands into the game page (shared-element).
// =============================================================================
function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Local UI tick — NOT server polling. One interval per mounted hype card.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = new Date(targetIso).getTime();
  const diff = Math.max(0, target - now);
  const totalMin = Math.floor(diff / 60000);
  return {
    total: diff,
    h: Math.floor(diff / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
    totalMin,
  };
}

function h2hLine(h2h, homeName, awayName) {
  if (!h2h || h2h.played === 0) return 'First meeting';
  const { homeWins, awayWins } = h2h;
  if (homeWins === awayWins) return `Season series tied ${homeWins}–${awayWins}`;
  const leader = homeWins > awayWins ? homeName : awayName;
  const hi = Math.max(homeWins, awayWins), lo = Math.min(homeWins, awayWins);
  return `${leader} lead the series ${hi}–${lo}`;
}

function TeamChip({ team, align }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <TeamLogo team={{ name: team.name, logo_url: team.logoUrl, logo_color: colors.surfaceElevated }} size={40} radius={10} />
      <span style={{ ...type.body, fontWeight: 700, color: C.ice, textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'stretch' }}>{team.name}</span>
      <span style={{ ...type.meta, color: C.steel, letterSpacing: '0.12em' }}>{align}</span>
    </div>
  );
}

export default function HypeCard({ game, currentUserId, navigate }) {
  const expand = useExpand();
  const cd = useCountdown(game.startTime);
  const [h2h, setH2h] = useState(null);
  const [rsvp, setRsvp] = useState(null);
  const [rsvpBusy, setRsvpBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getHeadToHead(game).then((r) => { if (alive) setH2h(r); });
    return () => { alive = false; };
  }, [game]);

  useEffect(() => {
    let alive = true;
    if (game.isMine && currentUserId) getRsvp(game.id, currentUserId).then((r) => { if (alive) setRsvp(r?.status || null); });
    return () => { alive = false; };
  }, [game.id, game.isMine, currentUserId]);

  const setStatus = async (status) => {
    if (rsvpBusy) return;
    const prev = rsvp;
    setRsvp(status); setRsvpBusy(true); // optimistic
    try { await upsertRsvp(game.id, currentUserId, status); }
    catch { setRsvp(prev); } // reconcile on failure — never strand the UI
    finally { setRsvpBusy(false); }
  };

  const countLabel = cd.total <= 0 ? 'Puck about to drop'
    : cd.h >= 1 ? `${cd.h}h ${cd.m}m` : `${cd.m}m ${cd.s}s`;

  return (
    <div
      onClick={(e) => expand(e, () => navigate(game.gameUrl), { bg: colors.surfaceElevated })}
      className="rinkd-pressable"
      style={{
        background: colors.surface, border: `1px solid ${C.border}`, borderRadius: radii.card,
        padding: 16, marginBottom: 12, cursor: 'pointer', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 3, height: 13, background: C.blue, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ ...type.sectionHead, fontSize: 13, color: C.steel, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Up Next · {game.eventName}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <TeamChip team={game.away} align="AWAY" />
        <div style={{ flexShrink: 0, textAlign: 'center', paddingTop: 4, minWidth: 78 }}>
          <div style={{ ...type.meta, color: C.steel, letterSpacing: '0.14em', marginBottom: 2 }}>PUCK DROP</div>
          <div style={{ fontFamily: font.display, fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1, color: cd.totalMin <= 30 ? C.red : C.ice, fontVariantNumeric: 'tabular-nums' }}>{countLabel}</div>
        </div>
        <TeamChip team={game.home} align="HOME" />
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, color: C.steel, ...type.meta, fontSize: 12 }}>
        <Icon name="analytics" size={13} color={C.steel} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h2hLine(h2h, game.home.name, game.away.name)}</span>
      </div>

      {game.isMine && currentUserId && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...type.body, fontWeight: 600, color: C.steel, flex: 1, minWidth: 0 }}>
            {rsvp === 'in' ? "You're in." : rsvp === 'out' ? "You're out this one." : 'You in?'}
          </span>
          <RsvpButton active={rsvp === 'in'} onClick={() => setStatus('in')} disabled={rsvpBusy} tone={C.red} label="I'm In" icon="approved" />
          <RsvpButton active={rsvp === 'out'} onClick={() => setStatus('out')} disabled={rsvpBusy} tone={C.steel} label="Out" icon="close" />
        </div>
      )}
    </div>
  );
}

function RsvpButton({ active, onClick, disabled, tone, label, icon }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
        padding: '7px 14px', borderRadius: radii.button, cursor: disabled ? 'wait' : 'pointer',
        background: active ? tone : 'transparent',
        border: `1px solid ${active ? tone : C.border}`,
        color: active ? '#fff' : C.ice,
        fontFamily: font.display, fontWeight: 900, fontStyle: 'italic', fontSize: 12,
        letterSpacing: '0.04em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <Icon name={icon} size={13} color={active ? '#fff' : C.ice} />{label}
    </button>
  );
}
