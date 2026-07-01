import { useState, useEffect, useCallback } from 'react';
import { getLineup } from '../lib/lineups';
import LineupModal from './LineupModal';
import { C } from '../lib/tokens';

/**
 * Prominent, stateful "set your lines" CTA for one scheduled game.
 *
 * Self-contained: it detects whether a lineup already exists, renders the
 * button, and owns its own LineupModal. Reusable across the team page, the
 * league schedule, and the game detail page so the action looks and behaves
 * identically everywhere.
 *
 * Renders NOTHING unless the viewer can manage the team AND the game is still
 * scheduled — so it never shows on finals and never shows to non-coaches.
 * (The old button was nested inside the game's location block, so it vanished
 * for any game with no rink set — this one always renders.)
 *
 * Props:
 *  - game      : schedule game { id, start_time, status, opponent, is_home,
 *                _source ('league'|'team'), home_team_id, away_team_id }
 *  - teamId    : the real teams.id (team-feed scope — what LineupModal expects)
 *  - teamName  : team name, for the modal title
 *  - canManage : viewer is coach/manager of this team
 *  - onSaved   : optional callback after a save (e.g. reload the page data)
 *  - block     : full-width primary button (default true) vs compact inline
 */
export default function LineupCTA({ game, teamId, teamName = '', canManage, onSaved, block = true }) {
  const isLeague = game?._source === 'league';
  const lineupTeamId = isLeague ? (game?.is_home ? game?.home_team_id : game?.away_team_id) : teamId;
  const gameSource = isLeague ? 'league' : 'team';
  const active = !!canManage && game?.status === 'scheduled';

  const [open, setOpen] = useState(false);
  const [linesSet, setLinesSet] = useState(null); // null = loading/unknown

  const refresh = useCallback(async () => {
    if (!game?.id || !lineupTeamId) return;
    try {
      const rows = await getLineup(game.id, lineupTeamId);
      setLinesSet(rows.length > 0);
    } catch { setLinesSet(false); }
  }, [game?.id, lineupTeamId]);

  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  if (!active) return null;

  const start = game?.start_time ? new Date(game.start_time).getTime() : null;
  const hoursTo = start != null ? (start - Date.now()) / 3.6e6 : null;
  const soon = hoursTo != null && hoursTo <= 3 && hoursTo > -1.5; // ~3h before → mid-game
  const done = linesSet === true;

  const label = done ? '✓ Lines set · tap to review'
    : soon ? '⏰ Set your lines — game soon'
    : '📋 Set your lines';

  const bg = done ? 'rgba(26,122,74,0.16)' : soon ? C.red : 'rgba(46,91,140,0.92)';
  const border = done ? 'rgba(26,122,74,0.9)' : soon ? C.red : C.blue;
  const color = done ? '#5FCF9A' : '#fff';

  const gameTitle = `${teamName} ${game?.is_home ? 'vs.' : '@'} ${game?.opponent || ''}${start != null ? ` · ${new Date(start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}`.trim();

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        style={{
          width: block ? '100%' : 'auto',
          minHeight: 44,
          marginTop: 8,
          padding: '10px 16px',
          borderRadius: 10,
          background: bg,
          border: `1.5px solid ${border}`,
          color,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontFamily: "'Barlow', sans-serif",
          boxShadow: soon ? '0 0 0 3px rgba(215,38,56,0.18)' : 'none',
        }}>
        {label}
      </button>
      {open && (
        <LineupModal
          open={open}
          onClose={() => setOpen(false)}
          gameId={game.id}
          gameSource={gameSource}
          teamId={teamId}
          lineupTeamId={lineupTeamId}
          gameTitle={gameTitle}
          onSaved={() => { setLinesSet(true); refresh(); if (onSaved) onSaved(); }}
        />
      )}
    </>
  );
}
