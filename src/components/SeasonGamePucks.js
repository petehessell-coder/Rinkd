import React, { useState, useEffect } from 'react';
import { getSeasonGamePucks } from '../lib/gamePucks';
import PuckMark from './PuckMark';
import { C } from '../lib/tokens';

// Rinkd Game Puck (SOCIAL-3, Phase 1) — season "Game Pucks won" board, the
// fan-vote companion to StatLeaderboards. Per final game, the most-voted
// (team, jersey) wins that game's puck (ties share); this counts pucks across a
// league or tournament. Jersey-keyed, best-effort name from lineups. Renders
// nothing until at least one game has votes, so the Stats tab stays clean early.
//
// Props: scope ('league' | 'tournament'), id, accent, youth.
//
// YOUTH-PRIVACY (C06 PR-1): `youth` (from areScorersHidden(parent.settings)) is
// belt-and-suspenders over the server shield — get_season_game_pucks already
// returns a NULL name on youth events, and this never renders player_name when
// `youth` is set. Mirrors StatLeaderboards.js's hideYouthName pattern.

const localC = {
  dim: 'rgba(244,247,250,0.5)', faint: 'rgba(244,247,250,0.3)',
  line: 'rgba(244,247,250,0.06)',
};

export default function SeasonGamePucks({ scope = 'tournament', id, accent = C.red, youth = false }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    getSeasonGamePucks(scope, id)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [scope, id]);

  if (!rows || rows.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <PuckMark size={18} />
        Game Pucks · Fans’ Pick
      </div>
      <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((r, i) => {
          // Youth events never render a player name — jersey-only, keeping team
          // context (team name is not minor PII).
          const showName = !youth && r.player_name;
          return (
          <div key={`${r.team_id}:${r.jersey}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderTop: i > 0 ? `0.5px solid ${localC.line}` : 'none' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: i === 0 ? accent : 'rgba(244,247,250,0.1)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {showName ? r.player_name : `#${r.jersey}`}
              </div>
              <div style={{ fontSize: 10, color: localC.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {showName ? `#${r.jersey} · ` : ''}{r.team_name || '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice, lineHeight: 1 }}>{r.pucks_won}</div>
              <div style={{ fontSize: 8.5, fontWeight: 700, color: localC.faint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{r.pucks_won === 1 ? 'Puck' : 'Pucks'}</div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
