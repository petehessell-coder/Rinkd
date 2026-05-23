import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Phase-1 review-only tournament leaderboards (skaters + goalies), jersey-keyed.
// Data comes from the get_tournament_skater_stats / get_tournament_goalie_stats
// RPCs (SECURITY INVOKER, anon-granted) so this renders on the public,
// unauthenticated Tournament page. No account needed for any player to appear —
// names resolve from game_lineups.invite_name.
//
// Built portable: when the League surface gets the same RPCs, this component
// takes a `source`/loader swap with no structural change.

const C = {
  card: '#0f2847', cardHdr: '#152e54',
  text: '#F4F7FA', dim: 'rgba(244,247,250,0.5)', dim2: 'rgba(244,247,250,0.65)',
  faint: 'rgba(244,247,250,0.3)', line: 'rgba(244,247,250,0.06)',
};

const stickyBg = C.card;
const stickyHdrBg = C.cardHdr;

function fmtPct(v) {
  if (v == null) return '—';
  // GameSheet style: 3 decimals, leading zero dropped for sub-1 values (.735).
  const s = Number(v).toFixed(3);
  return s.startsWith('0') ? s.slice(1) : s;
}
function fmtNum(v, dp) {
  if (v == null) return '—';
  return Number(v).toFixed(dp);
}

// Generic dark leaderboard table with a sticky-left identity cell (name +
// jersey/team subline) and horizontally scrollable numeric columns.
function StatTable({ rows, accent, idLabel, renderId, cols }) {
  const midCellW = 40;
  return (
    <div style={{ background: stickyBg, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ background: 'rgba(46,91,140,0.2)', fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.35)', textTransform: 'uppercase' }}>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: stickyHdrBg, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)', textAlign: 'left', padding: '8px 10px', minWidth: 150, maxWidth: 190 }}>{idLabel}</th>
              {cols.map(c => (
                <th key={c.key} style={{ textAlign: 'center', padding: '8px 4px', width: midCellW, minWidth: midCellW }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.team_id + ':' + row.jersey_number} style={{ borderTop: '0.5px solid ' + C.line }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: stickyBg, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)', padding: '9px 10px', minWidth: 150, maxWidth: 190 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: i === 0 ? accent : 'rgba(244,247,250,0.1)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>{renderId(row)}</div>
                  </div>
                </td>
                {cols.map(c => (
                  <td key={c.key} style={{ fontSize: 11, textAlign: 'center', color: c.strong ? C.text : C.dim2, fontWeight: c.strong ? 700 : 400, padding: '9px 4px', width: midCellW, minWidth: midCellW }}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TournamentStats({ tournamentId, accent = '#D72638' }) {
  const [view, setView] = useState('skaters');
  const [skaters, setSkaters] = useState(null);
  const [goalies, setGoalies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [sk, go] = await Promise.all([
      supabase.rpc('get_tournament_skater_stats', { p_tournament_id: tournamentId }),
      supabase.rpc('get_tournament_goalie_stats', { p_tournament_id: tournamentId }),
    ]);
    if (sk.error || go.error) {
      setError(true);
      setLoading(false);
      return;
    }
    // Goalies show on their own board; keep them out of the scoring leaders.
    setSkaters((sk.data || []).filter(r => !r.is_goalie));
    setGoalies(go.data || []);
    setLoading(false);
  }, [tournamentId]);

  useEffect(() => {
    let alive = true;
    load().catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [load]);

  if (loading) {
    return <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 40 }}>Loading stats…</div>;
  }
  if (error) {
    return (
      <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 40 }}>
        Couldn't load stats.{' '}
        <button onClick={load} style={{ background: 'transparent', border: 'none', color: accent, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }

  const hasSkaters = skaters && skaters.length > 0;
  const hasGoalies = goalies && goalies.length > 0;
  if (!hasSkaters && !hasGoalies) {
    return <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 40 }}>Player and goalie stats appear here as games go final.</div>;
  }

  const skaterCols = [
    { key: 'gp', label: 'GP', render: r => r.gp },
    { key: 'g', label: 'G', render: r => r.goals },
    { key: 'a', label: 'A', render: r => r.assists },
    { key: 'pts', label: 'PTS', render: r => r.points, strong: true },
    { key: 'pim', label: 'PIM', render: r => r.pim },
    { key: 'ppg', label: 'P/G', render: r => fmtNum(r.points_per_game, 2) },
  ];
  const goalieCols = [
    { key: 'gp', label: 'GP', render: r => r.gp },
    { key: 'rec', label: 'W-L-T', render: r => `${r.wins}-${r.losses}-${r.ties}` },
    { key: 'ga', label: 'GA', render: r => r.goals_against },
    { key: 'sa', label: 'SA', render: r => r.shots_against },
    { key: 'svp', label: 'SV%', render: r => fmtPct(r.save_pct), strong: true },
    { key: 'gaa', label: 'GAA', render: r => fmtNum(r.gaa, 2), strong: true },
    { key: 'so', label: 'SO', render: r => r.shutouts },
  ];

  const renderSkaterId = (r) => (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.player_name}</div>
      <div style={{ fontSize: 10, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{r.jersey_number} · {r.team_name}</div>
    </>
  );
  const renderGoalieId = renderSkaterId; // identical shape (name + #/team)

  const Toggle = ({ id, label, n }) => (
    <button onClick={() => setView(id)}
      style={{
        flex: 1, padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
        fontFamily: 'Barlow, sans-serif', borderRadius: 9, border: 'none',
        background: view === id ? accent : 'rgba(46,91,140,0.18)',
        color: view === id ? '#fff' : 'rgba(244,247,250,0.6)',
      }}>
      {label}{typeof n === 'number' ? ` (${n})` : ''}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Toggle id="skaters" label="Skaters" n={skaters ? skaters.length : 0} />
        <Toggle id="goalies" label="Goalies" n={goalies ? goalies.length : 0} />
      </div>

      {view === 'skaters' && (
        hasSkaters
          ? <StatTable rows={skaters} accent={accent} idLabel="Player" renderId={renderSkaterId} cols={skaterCols} />
          : <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 30 }}>No skater scoring logged yet.</div>
      )}

      {view === 'goalies' && (
        hasGoalies
          ? <>
              <StatTable rows={goalies} accent={accent} idLabel="Goalie" renderId={renderGoalieId} cols={goalieCols} />
              <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
                SV% &amp; GAA are computed from logged shots and goals. GAA is shown per game played. When goalies split a game, shots-against is attributed to the starter — exact for single-goalie games.
              </div>
            </>
          : <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 30 }}>No goalie stats yet — needs a finalized game with a goalie in the lineup.</div>
      )}
    </div>
  );
}
